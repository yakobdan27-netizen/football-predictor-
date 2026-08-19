import { estimateOverlap } from "./conflict-groups";
import {
  OVERLAP_PENALTY_LAMBDA,
  SELECTION_MAX_CANDIDATES,
  SELECTION_PRIMARY_TARGET,
} from "./config";
import type { MsamCandidate, MsamConflictGroup, ScoredMsamCandidate } from "./types";

function selectionObjective(
  selected: MsamCandidate[],
  overlapFn: typeof estimateOverlap
): number {
  let obj = selected.reduce((s, c) => s + c.msamScore, 0);
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      obj -=
        OVERLAP_PENALTY_LAMBDA *
        overlapFn(selected[i]!, selected[j]!);
    }
  }
  return obj;
}

/** Global optimization over eligible candidates — enumerate conflict-group diverse subsets. */
export function selectDiversifiedCandidates(
  candidates: MsamCandidate[]
): {
  primary: MsamCandidate[];
  alternatives: MsamCandidate[];
  rejected: MsamCandidate[];
  warnings: string[];
} {
  const eligible = candidates.filter((c) => c.eligible);
  const ineligible = candidates.filter((c) => !c.eligible);

  if (eligible.length === 0) {
    return {
      primary: [],
      alternatives: [],
      rejected: candidates,
      warnings: ["No eligible markets passed validation for this fixture."],
    };
  }

  const byScore = [...eligible].sort((a, b) => b.msamScore - a.msamScore);
  const groups = new Set<MsamConflictGroup>();
  let bestSubset: MsamCandidate[] = [];
  let bestObj = -Infinity;

  function search(
    idx: number,
    current: MsamCandidate[],
    usedGroups: Set<MsamConflictGroup>
  ) {
    if (current.length >= SELECTION_PRIMARY_TARGET || idx >= byScore.length) {
      if (current.length > 0) {
        const obj = selectionObjective(current, estimateOverlap);
        if (obj > bestObj) {
          bestObj = obj;
          bestSubset = [...current];
        }
      }
      return;
    }
    search(idx + 1, current, usedGroups);
    const c = byScore[idx]!;
    if (!usedGroups.has(c.conflictGroup)) {
      usedGroups.add(c.conflictGroup);
      current.push(c);
      search(idx + 1, current, usedGroups);
      current.pop();
      usedGroups.delete(c.conflictGroup);
    }
  }

  search(0, [], new Set());

  if (bestSubset.length === 0) {
    bestSubset = [byScore[0]!];
  }

  while (
    bestSubset.length < SELECTION_PRIMARY_TARGET &&
    bestSubset.length < eligible.length
  ) {
    const used = new Set(bestSubset.map((c) => c.conflictGroup));
    const next = byScore.find((c) => !used.has(c.conflictGroup));
    if (!next) break;
    bestSubset.push(next);
  }

  const primary = bestSubset.slice(0, SELECTION_PRIMARY_TARGET);
  const primaryCodes = new Set(primary.map((c) => c.marketCode));
  const alternatives = byScore
    .filter((c) => !primaryCodes.has(c.marketCode))
    .slice(0, SELECTION_MAX_CANDIDATES - primary.length);

  const warnings: string[] = [];
  const independentGroups = new Set(primary.map((c) => c.conflictGroup));
  if (independentGroups.size < SELECTION_PRIMARY_TARGET && eligible.length >= SELECTION_PRIMARY_TARGET) {
    warnings.push(
      `Only ${independentGroups.size} independent market families available as primaries.`
    );
  }
  if (primary.length < SELECTION_PRIMARY_TARGET) {
    warnings.push(
      `Fewer than ${SELECTION_PRIMARY_TARGET} diversified primaries: ${primary.length} eligible independent market(s).`
    );
  }

  return {
    primary,
    alternatives,
    rejected: [...ineligible, ...byScore.filter((c) => !primaryCodes.has(c.marketCode) && !alternatives.includes(c))],
    warnings,
  };
}

export function assignSelectionRoles(
  primary: MsamCandidate[],
  alternatives: MsamCandidate[],
  rejected: MsamCandidate[],
  scored: ScoredMsamCandidate[]
): ScoredMsamCandidate[] {
  const primaryCodes = new Set(primary.map((c) => c.marketCode));
  const altCodes = new Set(alternatives.map((c) => c.marketCode));
  let rank = 1;
  return scored.map((c) => {
    if (primaryCodes.has(c.marketCode)) {
      return {
        ...c,
        selectionRole: "primary" as const,
        primaryRank: rank++,
      };
    }
    if (altCodes.has(c.marketCode)) {
      return { ...c, selectionRole: "alternative" as const, primaryRank: null };
    }
    return { ...c, selectionRole: "rejected" as const, primaryRank: null };
  });
}
