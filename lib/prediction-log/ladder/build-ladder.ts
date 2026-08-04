import type { TwoHHeavyResult } from "@/lib/prediction-log/two-h-heavy";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { compareTwoHHeavy } from "@/lib/prediction-log/two-h-heavy";
import {
  COMBINED_HIGH,
  COMBINED_MEDIUM,
  FILL_FROM_DB,
  LADDER_CONFIG,
  MAX_LEGS,
  RISK_THRESHOLD,
  resolveConfTiers,
  tierRank,
  type ConfTier,
  type ConfTiers,
} from "./config";

export type RiskExposure = "HIGH" | "Medium" | "Low" | "Very Low";

export interface LadderMatch {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  /** Confidence tier label — not the drop-order letter. */
  tier: ConfTier;
  /** Kickoff datetime string, or FILL_FROM_DB when missing. */
  kickoff: string;
  /** Model P(2H>1H), or null when missing/non-finite. */
  p2h_gt_1h: number | null;
  /** Display string for probability. */
  p2h_display: string;
  confidence: number | null;
  confidence_display: string;
  survival: number | null;
  /** Drop-order letter: A = weakest (dropped first). Not the confidence tier. */
  letter: string;
  apiFixtureId?: number;
}

export interface LadderRound {
  round: number;
  label: string;
  bets: number;
  /** Match ids still in this round (strongest-first). */
  legIds: string[];
  /** Letters of legs still in the round (strongest-first). */
  legLetters: string[];
  /** Summary of legs for table column. */
  legsSummary: string;
  /** Per-leg P(2H>1H) percents, strongest-first (e.g. "J 72.0% · I 68.1%"). */
  leg_percents_display: string;
  /** Risky letters (p < RISK_THRESHOLD) still included. */
  risky_matches: string[];
  risky_display: string;
  combined_prob: number | null;
  combined_display: string;
  risk_exposure: RiskExposure;
  suggestedStake?: number;
}

export interface LadderSelectionAudit {
  /** Tier A floor (compat / slider). */
  confFloor: number;
  confTiers: ConfTiers;
  hardMin: number;
  maxPerLeagueInitial: number;
  maxPerLeagueUsed: number;
  /** Matches with conf >= HARD_MIN. */
  qualifiedCount: number;
  selectedCount: number;
  leagueCounts: Record<string, number>;
  tierCounts: Record<ConfTier, number>;
  tiersUsed: ConfTier[];
  /** Why the per-league cap was raised, if at all. */
  relaxReason: string | null;
}

export interface LadderResult {
  matches: LadderMatch[];
  rounds: LadderRound[];
  /** Drop order letters A.. (weakest first). */
  dropOrder: string[];
  shortfallNotice: string | null;
  /** Honest mix notice when B/C backfill was used to reach size. */
  mixNotice: string | null;
  n: number;
  selection: LadderSelectionAudit;
}

export type BuildLadderOpts = {
  ranked: TwoHHeavyResult[];
  batch: PredictionBatch;
  /** @deprecated Prefer ladderSize */
  maxLegs?: number;
  ladderSize?: number;
  /** Tier A floor (slider). */
  confFloor?: number;
  confTiers?: ConfTiers;
  maxPerLeague?: number;
  tieBand?: number;
};

function letterAt(index: number): string {
  return String.fromCharCode(65 + index);
}

function formatProb(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return FILL_FROM_DB;
  return `${(p * 100).toFixed(1)}%`;
}

function isFiniteProb(p: number | null | undefined): p is number {
  return p != null && Number.isFinite(p);
}

export function riskExposureFor(params: {
  combined_prob: number | null;
  bets: number;
  riskyCount: number;
}): RiskExposure {
  const { combined_prob, bets, riskyCount } = params;
  if (riskyCount >= 3) return "HIGH";
  if (combined_prob == null || !Number.isFinite(combined_prob)) return "HIGH";
  if (combined_prob < COMBINED_HIGH) return "HIGH";
  if (combined_prob <= COMBINED_MEDIUM) return "Medium";
  if (bets <= 2) return "Very Low";
  return "Low";
}

function kickoffFor(
  matchId: string,
  logById: Record<string, LogMatch>,
  batchDate: string
): string {
  const m = logById[matchId];
  const raw = m?.matchDate?.trim() || batchDate?.trim() || "";
  if (!raw) return FILL_FROM_DB;
  return raw;
}

function survivalScore(r: TwoHHeavyResult): number {
  if (!isFiniteProb(r.p_2h_gt_1h) || !Number.isFinite(r.confidence)) return -1;
  return r.p_2h_gt_1h * r.confidence;
}

function leagueKey(r: TwoHHeavyResult): string {
  return (r.league || "Unknown").trim() || "Unknown";
}

function countLeagues(selected: TwoHHeavyResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of selected) {
    const k = leagueKey(r);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function emptyTierCounts(): Record<ConfTier, number> {
  return { A: 0, B: 0, C: 0 };
}

function assignTier(
  ranked: TwoHHeavyResult[],
  tiers: ConfTiers,
  hardMin: number
): { pools: Record<ConfTier, TwoHHeavyResult[]>; qualifiedCount: number } {
  const pools: Record<ConfTier, TwoHHeavyResult[]> = { A: [], B: [], C: [] };
  let qualifiedCount = 0;
  for (const r of ranked) {
    if (!Number.isFinite(r.confidence) || r.confidence < hardMin) continue;
    qualifiedCount += 1;
    const c = r.confidence;
    if (c >= tiers.A) pools.A.push(r);
    else if (c >= tiers.B) pools.B.push(r);
    else pools.C.push(r);
  }
  for (const t of ["A", "B", "C"] as ConfTier[]) {
    pools[t].sort(compareTwoHHeavy);
  }
  return { pools, qualifiedCount };
}

/**
 * Tiered greedy fill: A → B → C. Per-league cap uses global counts across tiers;
 * relaxes +1 only within the current tier's remaining pool.
 */
export function selectDiversifiedLegs(
  ranked: TwoHHeavyResult[],
  opts: {
    ladderSize: number;
    maxPerLeague: number;
    confFloor?: number;
    confTiers?: ConfTiers;
    hardMin?: number;
  }
): {
  selected: TwoHHeavyResult[];
  tierById: Map<string, ConfTier>;
  qualifiedCount: number;
  maxPerLeagueUsed: number;
  relaxReason: string | null;
  leagueCounts: Record<string, number>;
  tierCounts: Record<ConfTier, number>;
  confTiers: ConfTiers;
  hardMin: number;
} {
  const hardMin = opts.hardMin ?? LADDER_CONFIG.HARD_MIN;
  const confTiers = opts.confTiers ?? resolveConfTiers(opts.confFloor);
  const { ladderSize, maxPerLeague: initialCap } = opts;

  const { pools, qualifiedCount } = assignTier(ranked, confTiers, hardMin);
  const selected: TwoHHeavyResult[] = [];
  const tierById = new Map<string, ConfTier>();
  const leagueCounts: Record<string, number> = {};
  const tierCounts = emptyTierCounts();
  let maxPerLeagueUsed = Math.max(1, initialCap);
  let relaxReason: string | null = null;
  const selectedIds = new Set<string>();

  for (const tier of ["A", "B", "C"] as ConfTier[]) {
    if (selected.length >= ladderSize) break;
    const pool = pools[tier];
    if (pool.length === 0) continue;

    let localCap = Math.max(1, initialCap);

    while (selected.length < ladderSize) {
      for (const r of pool) {
        if (selected.length >= ladderSize) break;
        if (selectedIds.has(r.matchId)) continue;
        const lg = leagueKey(r);
        const n = leagueCounts[lg] ?? 0;
        if (n < localCap) {
          selected.push(r);
          selectedIds.add(r.matchId);
          leagueCounts[lg] = n + 1;
          tierById.set(r.matchId, tier);
          tierCounts[tier] += 1;
        }
      }

      if (selected.length >= ladderSize) break;

      const remaining = pool.filter((r) => !selectedIds.has(r.matchId));
      if (remaining.length === 0) break;

      // Remaining are cap-blocked — relax among this tier only.
      if (localCap >= ladderSize) break;
      localCap += 1;
      maxPerLeagueUsed = Math.max(maxPerLeagueUsed, localCap);
      if (localCap > initialCap) {
        relaxReason = `Raised max-per-league from ${initialCap} to ${localCap} while filling Tier ${tier} (only among matches already in that tier pool).`;
      }
    }

    maxPerLeagueUsed = Math.max(maxPerLeagueUsed, localCap);
  }

  return {
    selected,
    tierById,
    qualifiedCount,
    maxPerLeagueUsed,
    relaxReason,
    leagueCounts: countLeagues(selected),
    tierCounts,
    confTiers,
    hardMin,
  };
}

export type SortDropOrderOpts = {
  tieBand: number;
  tierById: Map<string, ConfTier>;
};

/**
 * Drop order: weaker confidence tiers first (C → B → A), then ascending
 * rank_score = p × conf. Within TIE_BAND same-tier, thin most-represented league.
 */
export function sortDropOrder(
  selected: TwoHHeavyResult[],
  opts: SortDropOrderOpts | number
): TwoHHeavyResult[] {
  const tieBand =
    typeof opts === "number" ? opts : opts.tieBand;
  const tierById =
    typeof opts === "number"
      ? new Map<string, ConfTier>()
      : opts.tierById;
  const leagueCounts = countLeagues(selected);

  return [...selected].sort((a, b) => {
    const ta = tierById.get(a.matchId) ?? "A";
    const tb = tierById.get(b.matchId) ?? "A";
    const tr = tierRank(ta) - tierRank(tb);
    if (tr !== 0) return tr;

    const sa = survivalScore(a);
    const sb = survivalScore(b);
    if (Math.abs(sa - sb) > tieBand) return sa - sb;

    const ca = leagueCounts[leagueKey(a)] ?? 0;
    const cb = leagueCounts[leagueKey(b)] ?? 0;
    if (ca !== cb) return cb - ca;
    return a.p_2h_gt_1h - b.p_2h_gt_1h;
  });
}

/**
 * Build round-reduction ladder from 2H-heavy rankings.
 * Selection: tiers A→B→C + greedy per-league fill.
 * Drop order: tier first, then rank_score, TIE_BAND league thinning.
 */
export function buildLadder(params: BuildLadderOpts): LadderResult {
  const ladderSize =
    params.ladderSize ?? params.maxLegs ?? LADDER_CONFIG.LADDER_SIZE;
  const confTiers =
    params.confTiers ?? resolveConfTiers(params.confFloor);
  const maxPerLeague = params.maxPerLeague ?? LADDER_CONFIG.MAX_PER_LEAGUE;
  const tieBand = params.tieBand ?? LADDER_CONFIG.TIE_BAND;
  const hardMin = LADDER_CONFIG.HARD_MIN;

  const logById: Record<string, LogMatch> = {};
  for (const m of params.batch.matches) logById[m.id] = m;

  const pick = selectDiversifiedLegs(params.ranked, {
    ladderSize,
    maxPerLeague,
    confTiers,
    hardMin,
  });
  const selected = pick.selected;
  const n = selected.length;
  const tiersUsed = (["A", "B", "C"] as ConfTier[]).filter(
    (t) => pick.tierCounts[t] > 0
  );

  const audit: LadderSelectionAudit = {
    confFloor: confTiers.A,
    confTiers: pick.confTiers,
    hardMin: pick.hardMin,
    maxPerLeagueInitial: maxPerLeague,
    maxPerLeagueUsed: pick.maxPerLeagueUsed,
    qualifiedCount: pick.qualifiedCount,
    selectedCount: n,
    leagueCounts: pick.leagueCounts,
    tierCounts: pick.tierCounts,
    tiersUsed,
    relaxReason: pick.relaxReason,
  };

  let shortfallNotice: string | null = null;
  let mixNotice: string | null = null;

  if (pick.qualifiedCount === 0 || n === 0) {
    shortfallNotice = `Only 0 matches met the minimum (${hardMin}) today — ladder built with 0. We did not pad it with anything weaker.`;
  } else if (n < ladderSize) {
    shortfallNotice = `Only ${n} match${n === 1 ? "" : "es"} met the minimum (${hardMin}) today — ladder built with ${n}. We did not pad it with anything weaker.`;
  } else if (pick.tierCounts.B > 0 || pick.tierCounts.C > 0) {
    mixNotice = `${n} legs built — ${pick.tierCounts.A} Tier A, ${pick.tierCounts.B} Tier B, ${pick.tierCounts.C} Tier C. Backfill legs (B/C) are weaker and drop out first; only Tier-A picks remain in the final rounds.`;
  }

  if (n === 0) {
    return {
      matches: [],
      rounds: [],
      dropOrder: [],
      shortfallNotice:
        shortfallNotice ?? "No ranked matches in this batch.",
      mixNotice: null,
      n: 0,
      selection: audit,
    };
  }

  const dropOrdered = sortDropOrder(selected, {
    tieBand,
    tierById: pick.tierById,
  });

  const letterById = new Map<string, string>();
  const dropOrder: string[] = [];
  dropOrdered.forEach((r, i) => {
    const L = letterAt(i);
    letterById.set(r.matchId, L);
    dropOrder.push(L);
  });

  const matches: LadderMatch[] = dropOrdered.map((r) => {
    const p = isFiniteProb(r.p_2h_gt_1h) ? r.p_2h_gt_1h : null;
    const c = Number.isFinite(r.confidence) ? r.confidence : null;
    const survival = p != null && c != null ? p * c : null;
    const log = logById[r.matchId];
    return {
      matchId: r.matchId,
      homeTeam: r.homeTeam || log?.homeTeam || FILL_FROM_DB,
      awayTeam: r.awayTeam || log?.awayTeam || FILL_FROM_DB,
      league: leagueKey(r),
      tier: pick.tierById.get(r.matchId) ?? "A",
      kickoff: kickoffFor(r.matchId, logById, params.batch.date),
      p2h_gt_1h: p,
      p2h_display: formatProb(p),
      confidence: c,
      confidence_display: formatProb(c),
      survival,
      letter: letterById.get(r.matchId)!,
      apiFixtureId: log?.apiFixtureId,
    };
  });

  const matchById = new Map(matches.map((m) => [m.matchId, m]));

  const rounds: LadderRound[] = [];
  for (let k = 1; k <= n; k++) {
    const kept = dropOrdered.slice(k - 1);
    const keptStrongFirst = [...kept].reverse();
    const legIds = keptStrongFirst.map((r) => r.matchId);
    const legLetters = keptStrongFirst.map((r) => letterById.get(r.matchId)!);

    let combined: number | null = 1;
    for (const r of kept) {
      if (!isFiniteProb(r.p_2h_gt_1h)) {
        combined = null;
        break;
      }
      combined *= r.p_2h_gt_1h;
    }

    const risky: string[] = [];
    for (const r of keptStrongFirst) {
      const m = matchById.get(r.matchId)!;
      if (m.p2h_gt_1h == null || m.p2h_gt_1h < RISK_THRESHOLD) {
        risky.push(m.letter);
      }
    }

    const bets = kept.length;
    const exposure = riskExposureFor({
      combined_prob: combined,
      bets,
      riskyCount: risky.length,
    });

    let legsSummary: string;
    if (k === 1) legsSummary = "all";
    else if (k === n) legsSummary = "best only";
    else legsSummary = `drop weakest ${k - 1}`;

    const leg_percents_display = keptStrongFirst
      .map((r) => {
        const m = matchById.get(r.matchId)!;
        return `${m.letter} ${m.p2h_display}`;
      })
      .join(" · ");

    rounds.push({
      round: k,
      label: `R${k}`,
      bets,
      legIds,
      legLetters,
      legsSummary,
      leg_percents_display,
      risky_matches: risky,
      risky_display: risky.length ? risky.join(", ") : "—",
      combined_prob: combined,
      combined_display: formatProb(combined),
      risk_exposure: exposure,
    });
  }

  return {
    matches,
    rounds,
    dropOrder,
    shortfallNotice,
    mixNotice,
    n,
    selection: audit,
  };
}

export function legsForRound(
  ladder: LadderResult,
  round: LadderRound
): LadderMatch[] {
  const byId = new Map(ladder.matches.map((m) => [m.matchId, m]));
  return round.legIds
    .map((id) => byId.get(id))
    .filter((m): m is LadderMatch => m != null);
}

/** Short league label for distribution strip / tags. */
export function shortLeagueLabel(league: string): string {
  const map: Record<string, string> = {
    "Premier League": "EPL",
    "La Liga": "LaLiga",
    "Serie A": "SerieA",
    Bundesliga: "Bundesliga",
    "Ligue 1": "Ligue1",
  };
  return map[league] ?? league;
}

export const TIER_TOOLTIP =
  "A = met primary confidence floor; B/C = backfill to complete the 10, lower confidence, dropped first in the ladder.";

// Re-export thresholds for tests/UI docs
export {
  COMBINED_HIGH,
  COMBINED_MEDIUM,
  RISK_THRESHOLD,
  FILL_FROM_DB,
  MAX_LEGS,
  LADDER_CONFIG,
  CONF_FLOOR,
  resolveConfTiers,
} from "./config";
