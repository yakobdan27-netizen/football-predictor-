import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { CanonicalProposition } from "../types";

export function scoreDis(input: {
  prop: CanonicalProposition;
  cfe: CanonicalFixtureEstimate;
  fixtureIdentityOk: boolean;
}): number {
  const { prop, cfe, fixtureIdentityOk } = input;
  if (!fixtureIdentityOk) return 0;

  let score = 80;
  if (cfe.provenance.sourceBreakdown === "blended") score += 10;
  if (cfe.diagnostics.halfSumOk) score += 5;
  if (!prop.coherenceOk) score -= 30;
  if (cfe.confidence_tier === "low") score -= 15;

  return Math.max(0, Math.min(100, score));
}
