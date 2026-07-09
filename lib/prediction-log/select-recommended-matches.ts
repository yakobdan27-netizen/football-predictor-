import { combinedOddsProduct } from "./match-risk-score";
import type { RecommendationSettings } from "./types";
import type { ScoredMatchCandidate } from "./match-risk-score";

export interface MatchSelectionResult {
  selected: ScoredMatchCandidate[];
  excluded: ScoredMatchCandidate[];
  totalCombinedOdds: number | null;
}

export function selectRecommendedMatches(
  candidates: ScoredMatchCandidate[],
  _settings: RecommendationSettings
): MatchSelectionResult {
  const passing = candidates.filter((c) => c.passesHardFilters);
  const failing = candidates.map((c) => ({
    ...c,
    exclusionReason: c.exclusionReason ?? "Failed hard risk filters.",
  }));

  const selected = [...passing].sort((a, b) => {
    const aPSignal = a.pick.pSignal ?? a.combinedScore;
    const bPSignal = b.pick.pSignal ?? b.combinedScore;
    return bPSignal - aPSignal || b.combinedScore - a.combinedScore;
  });

  const product = combinedOddsProduct(selected);

  return {
    selected,
    excluded: failing,
    totalCombinedOdds: selected.length > 0 ? product : null,
  };
}
