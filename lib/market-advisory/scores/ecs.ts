import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { MarketFamilyId } from "@/lib/slip-builder/types";
import {
  MIN_ESS_CORNERS,
  MIN_ESS_DEFAULT,
  MIN_ESS_HALF,
} from "../config";
import type { CanonicalProposition } from "../types";

const HALF_FAMILIES = new Set<MarketFamilyId>([
  "HALF_GOALS",
  "HSH",
  "HT_RESULT",
  "DIEH",
  "WIN_ONE_HALF",
]);

export function minEssForFamily(family: MarketFamilyId): number {
  if (family === "CORNERS" || family === "SOT") return MIN_ESS_CORNERS;
  if (HALF_FAMILIES.has(family)) return MIN_ESS_HALF;
  return MIN_ESS_DEFAULT;
}

export function scoreEcs(input: {
  prop: CanonicalProposition;
  cfe: CanonicalFixtureEstimate;
}): number {
  const { prop, cfe } = input;
  const minEss = minEssForFamily(prop.marketFamily);
  const ess = cfe.provenance.ess;
  const essScore = Math.min(100, (ess / minEss) * 70);

  let coverageBonus = 0;
  if (HALF_FAMILIES.has(prop.marketFamily)) {
    const ht = cfe.coverage.ht_pct;
    if (ht != null) coverageBonus = Math.min(20, ht * 0.2);
    else return Math.min(100, essScore * 0.5);
  }
  if (prop.marketFamily === "CORNERS") {
    const c = cfe.coverage.corners_pct;
    if (c != null) coverageBonus = Math.min(20, c * 0.2);
    else return Math.min(100, essScore * 0.5);
  }
  if (prop.marketFamily === "DIEH") {
    if (cfe.markets.dieh.status !== "ok") {
      return Math.min(100, essScore * 0.4);
    }
    coverageBonus = 10;
  }

  const tierBonus =
    cfe.confidence_tier === "high"
      ? 10
      : cfe.confidence_tier === "medium"
        ? 5
        : 0;

  return Math.max(0, Math.min(100, essScore + coverageBonus + tierBonus));
}
