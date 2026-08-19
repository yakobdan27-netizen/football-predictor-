import { buildScoreMatrix } from "@/lib/predictor/score-matrix";
import { resolveCfeLegProbability } from "@/lib/prediction-log/cfe-leg-probability";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import { SSS_HIGH_SENSITIVITY, SSS_PERTURBATION_COUNT } from "../config";
import type { CanonicalProposition } from "../types";

function stabilityFromSpread(delta: number): number {
  return Math.max(0, Math.min(100, 100 * (1 - delta / 0.25)));
}

export function scoreSss(input: {
  prop: CanonicalProposition;
  cfe: CanonicalFixtureEstimate;
}): { score: number; delta: number; highSensitivity: boolean } {
  const { prop, cfe } = input;
  const probs: number[] = [prop.rawProbability];
  const lh = cfe.lambdas.home;
  const la = cfe.lambdas.away;
  const rho = cfe.rho;
  const deltas = [0.85, 0.92, 1.0, 1.08, 1.15];

  for (let i = 0; i < Math.min(SSS_PERTURBATION_COUNT, deltas.length); i++) {
    const d = deltas[i]!;
    const grid = buildScoreMatrix(lh * d, la * d, rho, 9);
    const slice = { ...cfe, score_matrix: grid };
    const r = resolveCfeLegProbability({
      estimate: slice,
      family: prop.marketFamily,
      selectionKey: prop.selectionKey,
      line: prop.line,
      comboId: prop.comboId,
    });
    if (r.available) probs.push(r.prob);
  }

  probs.sort((a, b) => a - b);
  const p10 = probs[Math.floor(probs.length * 0.1)] ?? probs[0]!;
  const p90 = probs[Math.ceil(probs.length * 0.9) - 1] ?? probs[probs.length - 1]!;
  const delta = p90 - p10;
  const highSensitivity = delta >= SSS_HIGH_SENSITIVITY;

  return {
    score: stabilityFromSpread(delta),
    delta,
    highSensitivity,
  };
}
