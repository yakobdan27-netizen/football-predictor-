/**
 * Shadow comparison: legacy pCalibrated ranking vs MSAM collaborative ranking.
 */
import type { PortfolioCategoryId } from "./weekend-portfolio";

export type PortfolioShadowDiff = {
  category: PortfolioCategoryId;
  legacyTopFixtureId: number | null;
  collaborativeTopFixtureId: number | null;
  disagrees: boolean;
};

export function comparePortfolioRankings(input: {
  category: PortfolioCategoryId;
  legacyOrder: number[];
  collaborativeOrder: number[];
}): PortfolioShadowDiff {
  const legacyTop = input.legacyOrder[0] ?? null;
  const collabTop = input.collaborativeOrder[0] ?? null;
  return {
    category: input.category,
    legacyTopFixtureId: legacyTop,
    collaborativeTopFixtureId: collabTop,
    disagrees:
      legacyTop != null &&
      collabTop != null &&
      legacyTop !== collabTop,
  };
}

export function formatShadowDiffs(diffs: PortfolioShadowDiff[]): string[] {
  return diffs
    .filter((d) => d.disagrees)
    .map(
      (d) =>
        `Portfolio shadow: ${d.category} top pick differs (legacy fixture ${d.legacyTopFixtureId} vs collaborative ${d.collaborativeTopFixtureId})`
    );
}
