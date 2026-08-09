/**
 * Global slip assignment — maximizes Σ p_calibrated under hard constraints.
 * Not greedy: uses backtracking with Hungarian layer for K=1, plus greedy baseline.
 */
import { bestLegPerFixture, compareLegs, sortCandidates } from "./candidate-pool";
import type { FamilyPool } from "./candidate-pool";
import {
  exceedsCorrelationCeiling,
  maxPairwiseRho,
  meanPairwiseRho,
  pairwiseRhoMatrix,
  slipBand,
  worstViolation,
  type RhoLookup,
} from "./correlation";
import { hungarianMaximize } from "./hungarian";
import type {
  BuiltSlip,
  BuiltSlipLeg,
  CandidateLeg,
  FilteredLeg,
  MarketFamilyId,
  SlipBatchResult,
  SlipPreferences,
} from "./types";
import { conflictGroupOf, validateFamilySelection } from "./types";

const TOP_M = 40;

export type OptimizeInput = {
  prefs: SlipPreferences;
  byFamily: FamilyPool[];
  allFiltered: FilteredLeg[];
  rhoLookup: RhoLookup;
  batchId?: string;
  batchNumber?: number;
  excludeFixtureIds?: string[];
};

function totalScore(slips: BuiltSlip[]): number {
  let s = 0;
  for (const slip of slips) {
    for (const leg of slip.legs) s += leg.pCalibrated;
  }
  return s;
}

function toBuiltLeg(
  leg: CandidateLeg,
  source: BuiltSlipLeg["selectionSource"],
  rank: number | null,
  corr: number
): BuiltSlipLeg {
  return {
    ...leg,
    selectionSource: source,
    machineRank: rank,
    correlationContribution: corr,
  };
}

function finalizeSlip(
  slipIndex: number,
  family: MarketFamilyId,
  legs: BuiltSlipLeg[],
  rhoLookup: RhoLookup
): BuiltSlip {
  const matrix = pairwiseRhoMatrix(legs, rhoLookup);
  const meanRho = meanPairwiseRho(matrix);
  const band = slipBand(
    legs.map((l) => l.pCalibrated),
    meanRho
  );
  const provisional = legs.some((l) => !l.calibrated);
  const manuallyAltered = legs.some(
    (l) => l.selectionSource === "manual_add" || l.selectionSource === "swap"
  );
  // Annotate per-leg mean corr to others
  const annotated = legs.map((leg, i) => {
    let sum = 0;
    let n = 0;
    for (let j = 0; j < legs.length; j++) {
      if (i === j) continue;
      sum += matrix[i]![j]!;
      n++;
    }
    return { ...leg, correlationContribution: n > 0 ? sum / n : 0 };
  });
  return {
    slipIndex,
    family,
    legs: annotated,
    independenceUpper: band.independenceUpper,
    bandLower: band.bandLower,
    bandUpper: band.bandUpper,
    meanRho,
    provisional,
    manuallyAltered,
  };
}

function competitionOk(
  chosen: CandidateLeg[],
  next: CandidateLeg,
  maxPer: number
): boolean {
  const count = chosen.filter((l) => l.competition === next.competition).length;
  return count < maxPer;
}

function repairCorrelation(
  legs: CandidateLeg[],
  pool: CandidateLeg[],
  usedFixtures: Set<string>,
  prefs: SlipPreferences,
  rhoLookup: RhoLookup
): CandidateLeg[] {
  let current = [...legs];
  const blocked = new Set(current.map((l) => `${l.fixtureId}|${l.selectionKey}`));
  for (let guard = 0; guard < 20; guard++) {
    const matrix = pairwiseRhoMatrix(current, rhoLookup);
    if (!exceedsCorrelationCeiling(matrix, prefs.correlationCeiling)) {
      return current;
    }
    const viol = worstViolation(current, matrix, prefs.correlationCeiling);
    if (!viol) return current;
    const victim = current[viol.replaceIndex]!;
    const remainingUsed = new Set(usedFixtures);
    for (const l of current) {
      if (l !== victim) remainingUsed.add(l.fixtureId);
    }
    const replacement = pool.find(
      (c) =>
        !blocked.has(`${c.fixtureId}|${c.selectionKey}`) &&
        !remainingUsed.has(c.fixtureId) &&
        c.fixtureId !== victim.fixtureId &&
        competitionOk(
          current.filter((_, i) => i !== viol.replaceIndex),
          c,
          prefs.maxLegsPerCompetition
        )
    );
    if (!replacement) {
      // Cannot repair — drop victim rather than keep high ρ
      current = current.filter((_, i) => i !== viol.replaceIndex);
      continue;
    }
    blocked.add(`${replacement.fixtureId}|${replacement.selectionKey}`);
    current[viol.replaceIndex] = replacement;
  }
  return current;
}

/** Greedy: each family takes top-K unused fixtures — baseline for test #5. */
export function assignGreedy(input: OptimizeInput): BuiltSlip[] {
  const { prefs, rhoLookup } = input;
  const K = prefs.legsPerSlip;
  const used = new Set<string>();
  const slips: BuiltSlip[] = [];
  let slipIndex = 0;

  for (const pool of input.byFamily) {
    if (pool.eligible.length === 0) continue;
    const candidates = sortCandidates(pool.eligible).slice(0, TOP_M * 2);
    const picked: CandidateLeg[] = [];
    for (const leg of candidates) {
      if (picked.length >= K) break;
      if (used.has(leg.fixtureId)) continue;
      if (!competitionOk([...picked], leg, prefs.maxLegsPerCompetition)) continue;
      // provisional check vs already picked
      const trial = [...picked, leg];
      const matrix = pairwiseRhoMatrix(trial, rhoLookup);
      if (exceedsCorrelationCeiling(matrix, prefs.correlationCeiling)) continue;
      picked.push(leg);
      used.add(leg.fixtureId);
    }
    const repaired = repairCorrelation(
      picked,
      candidates,
      used,
      prefs,
      rhoLookup
    );
    for (const l of repaired) used.add(l.fixtureId);
    if (repaired.length === 0) continue;
    slips.push(
      finalizeSlip(
        slipIndex++,
        pool.family,
        repaired.map((l, i) => toBuiltLeg(l, "machine", i + 1, 0)),
        rhoLookup
      )
    );
  }
  return slips;
}

/** K=1: Hungarian over fixture × family best scores. */
function assignHungarianK1(input: OptimizeInput): BuiltSlip[] | null {
  const viable = input.byFamily.filter((p) => p.eligible.length > 0);
  if (viable.length === 0) return null;

  const bestMaps = viable.map((p) => bestLegPerFixture(p.eligible));
  const fixtureSet = new Set<string>();
  for (const m of bestMaps) for (const id of m.keys()) fixtureSet.add(id);
  const fixtures = [...fixtureSet].sort();
  if (fixtures.length === 0) return null;

  const F = viable.length;
  // Score matrix: rows = fixtures, cols = families
  const score: number[][] = fixtures.map((fid) =>
    viable.map((pool, j) => {
      const leg = bestMaps[j]!.get(fid);
      return leg ? leg.pCalibrated : -1e9;
    })
  );

  // We need F fixtures assigned to F families. If more fixtures, pad families
  // by taking top F rows via selecting assignment of size min.
  // Hungarian on fixtures×families when fixtures >= F: expand cols? Better:
  // transpose so rows=families, cols=fixtures and pick one fixture per family.
  const familyScores: number[][] = viable.map((_, j) =>
    fixtures.map((fid) => {
      const leg = bestMaps[j]!.get(fid);
      return leg ? leg.pCalibrated : -1e9;
    })
  );
  const assignment = hungarianMaximize(familyScores);
  const used = new Set<string>();
  const slips: BuiltSlip[] = [];
  for (let j = 0; j < F; j++) {
    const col = assignment[j]!;
    if (col < 0) continue;
    const fid = fixtures[col]!;
    if (used.has(fid)) continue;
    const leg = bestMaps[j]!.get(fid);
    if (!leg || leg.pCalibrated < 0) continue;
    used.add(fid);
    slips.push(
      finalizeSlip(
        slips.length,
        viable[j]!.family,
        [toBuiltLeg(leg, "machine", 1, 0)],
        input.rhoLookup
      )
    );
  }
  return slips;
}

type PartialPick = { family: MarketFamilyId; legs: CandidateLeg[] };

function scorePartial(picks: PartialPick[]): number {
  let s = 0;
  for (const p of picks) for (const l of p.legs) s += l.pCalibrated;
  return s;
}

function upperBoundRemaining(
  picks: PartialPick[],
  remainingPools: FamilyPool[],
  K: number,
  used: Set<string>
): number {
  let bound = scorePartial(picks);
  for (const pool of remainingPools) {
    const top = sortCandidates(pool.eligible)
      .filter((l) => !used.has(l.fixtureId))
      .slice(0, K);
    for (const l of top) bound += l.pCalibrated;
  }
  return bound;
}

function pickKForFamily(
  pool: FamilyPool,
  K: number,
  used: Set<string>,
  prefs: SlipPreferences,
  rhoLookup: RhoLookup,
  alreadyGlobal: CandidateLeg[]
): CandidateLeg[][] {
  const candidates = sortCandidates(pool.eligible)
    .filter((l) => !used.has(l.fixtureId))
    .slice(0, TOP_M);
  if (candidates.length === 0) return [[]];

  const results: CandidateLeg[][] = [];
  const path: CandidateLeg[] = [];

  function dfs(start: number) {
    if (path.length === K || start >= candidates.length) {
      if (path.length > 0) results.push([...path]);
      return;
    }
    // Also allow stopping early if we already have some — only for final completeness
    // We generate exactly min(K, available) combinations greedily via branch
    for (let i = start; i < candidates.length; i++) {
      const c = candidates[i]!;
      if (path.some((p) => p.fixtureId === c.fixtureId)) continue;
      if (!competitionOk([...alreadyGlobal, ...path], c, prefs.maxLegsPerCompetition)) {
        continue;
      }
      const trial = [...path, c];
      const matrix = pairwiseRhoMatrix(trial, rhoLookup);
      if (exceedsCorrelationCeiling(matrix, prefs.correlationCeiling)) continue;
      path.push(c);
      dfs(i + 1);
      path.pop();
      if (results.length >= 60) return; // cap branching
    }
    if (path.length > 0 && path.length < K && start >= candidates.length) {
      results.push([...path]);
    }
  }

  dfs(0);

  // Ensure at least the greedy prefix is present
  if (results.length === 0) {
    const greedy: CandidateLeg[] = [];
    for (const c of candidates) {
      if (greedy.length >= K) break;
      if (greedy.some((p) => p.fixtureId === c.fixtureId)) continue;
      if (!competitionOk([...alreadyGlobal, ...greedy], c, prefs.maxLegsPerCompetition)) {
        continue;
      }
      const trial = [...greedy, c];
      if (
        exceedsCorrelationCeiling(
          pairwiseRhoMatrix(trial, rhoLookup),
          prefs.correlationCeiling
        )
      ) {
        continue;
      }
      greedy.push(c);
    }
    if (greedy.length) results.push(greedy);
  }

  // Prefer higher total score combos
  results.sort((a, b) => {
    const sa = a.reduce((s, l) => s + l.pCalibrated, 0);
    const sb = b.reduce((s, l) => s + l.pCalibrated, 0);
    if (Math.abs(sa - sb) > 1e-12) return sb - sa;
    // deterministic
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = compareLegs(a[i]!, b[i]!);
      if (c !== 0) return -c;
    }
    return b.length - a.length;
  });

  return results.slice(0, 40);
}

/** Global backtracking over families in Q1 order. */
export function assignGlobal(input: OptimizeInput): BuiltSlip[] {
  const { prefs, rhoLookup } = input;
  const validation = validateFamilySelection(prefs.families);
  if (!validation.ok) return [];

  const K = prefs.legsPerSlip;
  if (K === 1) {
    const hung = assignHungarianK1(input);
    if (hung && hung.length > 0) {
      // Still run repair for ρ
      return hung.map((s) => {
        const repaired = repairCorrelation(
          s.legs,
          input.byFamily.find((p) => p.family === s.family)?.eligible ?? s.legs,
          new Set(
            hung.flatMap((x) =>
              x.family === s.family ? [] : x.legs.map((l) => l.fixtureId)
            )
          ),
          prefs,
          rhoLookup
        );
        return finalizeSlip(
          s.slipIndex,
          s.family,
          repaired.map((l, i) => toBuiltLeg(l, "machine", i + 1, 0)),
          rhoLookup
        );
      });
    }
  }

  const viable = input.byFamily.filter((p) => p.eligible.length > 0);
  let best: PartialPick[] = [];
  let bestScore = -1;

  function search(fi: number, picks: PartialPick[], used: Set<string>) {
    if (fi >= viable.length) {
      const sc = scorePartial(picks);
      if (sc > bestScore + 1e-12) {
        bestScore = sc;
        best = picks.map((p) => ({ family: p.family, legs: [...p.legs] }));
      } else if (Math.abs(sc - bestScore) <= 1e-12) {
        // Deterministic tie: lexicographic fixture/selection keys
        const key = (pp: PartialPick[]) =>
          pp
            .map(
              (p) =>
                p.family +
                ":" +
                p.legs.map((l) => `${l.fixtureId}|${l.selectionKey}`).join(",")
            )
            .join(";");
        if (key(picks) < key(best)) {
          best = picks.map((p) => ({ family: p.family, legs: [...p.legs] }));
        }
      }
      return;
    }

    if (upperBoundRemaining(picks, viable.slice(fi), K, used) < bestScore - 1e-12) {
      return;
    }

    const pool = viable[fi]!;
    const combos = pickKForFamily(
      pool,
      K,
      used,
      prefs,
      rhoLookup,
      picks.flatMap((p) => p.legs)
    );

    // Also allow skipping family only if it has zero viable after filters — already filtered
    if (combos.length === 0 || (combos.length === 1 && combos[0]!.length === 0)) {
      search(fi + 1, picks, used);
      return;
    }

    for (const combo of combos) {
      if (combo.length === 0) continue;
      const nextUsed = new Set(used);
      for (const l of combo) nextUsed.add(l.fixtureId);
      search(
        fi + 1,
        [...picks, { family: pool.family, legs: combo }],
        nextUsed
      );
    }
  }

  search(0, [], new Set());

  const usedAll = new Set<string>();
  const slips: BuiltSlip[] = [];
  for (const pick of best) {
    for (const l of pick.legs) usedAll.add(l.fixtureId);
  }
  for (const pick of best) {
    const pool =
      input.byFamily.find((p) => p.family === pick.family)?.eligible ?? [];
    const others = new Set(
      [...usedAll].filter((id) => !pick.legs.some((l) => l.fixtureId === id))
    );
    const repaired = repairCorrelation(pick.legs, pool, others, prefs, rhoLookup);
    for (const l of repaired) usedAll.add(l.fixtureId);
    if (repaired.length === 0) continue;
    slips.push(
      finalizeSlip(
        slips.length,
        pick.family,
        repaired.map((l, i) => toBuiltLeg(l, "machine", i + 1, 0)),
        rhoLookup
      )
    );
  }
  return slips;
}

export function optimizeSlipBatch(input: OptimizeInput): SlipBatchResult {
  const prefs = input.prefs;
  const validation = validateFamilySelection(prefs.families);
  if (!validation.ok) {
    return {
      batchId: input.batchId ?? "local",
      batchNumber: input.batchNumber ?? 0,
      generatedAt: new Date().toISOString(),
      preferences: prefs,
      slips: [],
      filtered: input.allFiltered,
      partialReason: `Conflict group ${validation.groupId}: ${validation.conflict[0]} and ${validation.conflict[1]} cannot both be selected.`,
      fixtureExclusionIds: input.excludeFixtureIds ?? [],
    };
  }

  // Enforce conflict groups across returned families
  const seenGroups = new Set<string>();
  for (const f of prefs.families) {
    const g = conflictGroupOf(f);
    if (g) {
      if (seenGroups.has(g)) {
        /* validated above */
      }
      seenGroups.add(g);
    }
  }

  const slips = assignGlobal(input);
  const viableFamilies = input.byFamily.filter((p) => p.eligible.length > 0);
  let partialReason: string | null = null;
  if (slips.length < 4) {
    if (viableFamilies.length < 4) {
      partialReason = `Only ${viableFamilies.length} market ${
        viableFamilies.length === 1 ? "family has" : "families have"
      } qualifying fixtures — returned ${slips.length} slip(s) instead of duplicating a family.`;
    } else if (slips.length < prefs.families.length) {
      partialReason = `Could not fill all ${prefs.families.length} slips under fixture uniqueness and correlation constraints — returned ${slips.length}.`;
    }
  }

  return {
    batchId: input.batchId ?? "local",
    batchNumber: input.batchNumber ?? 0,
    generatedAt: new Date().toISOString(),
    preferences: prefs,
    slips,
    filtered: input.allFiltered,
    partialReason,
    fixtureExclusionIds: input.excludeFixtureIds ?? [],
  };
}

/** Swap one leg with next-best candidate preserving constraints. */
export function swapLeg(input: {
  result: SlipBatchResult;
  slipIndex: number;
  legOrder: number;
  byFamily: FamilyPool[];
  rhoLookup: RhoLookup;
}): SlipBatchResult {
  const { result, slipIndex, legOrder, byFamily, rhoLookup } = input;
  const slip = result.slips[slipIndex];
  if (!slip) return result;
  const victim = slip.legs[legOrder];
  if (!victim) return result;

  const used = new Set(
    result.slips.flatMap((s) => s.legs.map((l) => l.fixtureId))
  );
  used.delete(victim.fixtureId);

  const pool =
    byFamily.find((p) => p.family === slip.family)?.eligible ?? [];
  const others = slip.legs.filter((_, i) => i !== legOrder);
  const candidate = sortCandidates(pool).find((c) => {
    if (used.has(c.fixtureId)) return false;
    if (
      c.fixtureId === victim.fixtureId &&
      c.selectionKey === victim.selectionKey
    ) {
      return false;
    }
    if (
      !competitionOk(
        result.slips.flatMap((s, si) =>
          si === slipIndex ? others : s.legs
        ),
        c,
        result.preferences.maxLegsPerCompetition
      )
    ) {
      return false;
    }
    const trial = [...others, c];
    return !exceedsCorrelationCeiling(
      pairwiseRhoMatrix(trial, rhoLookup),
      result.preferences.correlationCeiling
    );
  });

  if (!candidate) return result;

  const newLegs = slip.legs.map((l, i) =>
    i === legOrder
      ? toBuiltLeg(candidate, "swap", null, 0)
      : l
  );
  const newSlip = finalizeSlip(slipIndex, slip.family, newLegs, rhoLookup);
  const slips = result.slips.map((s, i) => (i === slipIndex ? newSlip : s));
  return { ...result, slips };
}

/** Manual add — never blocked; marks slip altered. */
export function manualAddLeg(input: {
  result: SlipBatchResult;
  slipIndex: number;
  leg: CandidateLeg;
  rhoLookup: RhoLookup;
}): SlipBatchResult {
  const { result, slipIndex, leg, rhoLookup } = input;
  const slip = result.slips[slipIndex];
  if (!slip) return result;
  const warning =
    leg.pCalibrated < result.preferences.pMin ||
    leg.nEffective < 30 ||
    !leg.calibrated ||
    !leg.coherenceOk
      ? "Manually added leg fails one or more eligibility gates."
      : undefined;
  const built = toBuiltLeg(leg, "manual_add", null, 0);
  if (warning) built.warning = warning;
  const newLegs = [...slip.legs, built];
  const newSlip = {
    ...finalizeSlip(slipIndex, slip.family, newLegs, rhoLookup),
    manuallyAltered: true,
  };
  const slips = result.slips.map((s, i) => (i === slipIndex ? newSlip : s));
  return { ...result, slips };
}

export function batchTotalScore(slips: BuiltSlip[]): number {
  return totalScore(slips);
}

export function maxRhoInSlip(slip: BuiltSlip, rhoLookup: RhoLookup): number {
  return maxPairwiseRho(pairwiseRhoMatrix(slip.legs, rhoLookup));
}
