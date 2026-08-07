/**
 * Canonical prediction blend: 60% API-DB · 40% Manual/AI.
 * Supersedes any 50/50 hybrid. All analysis surfaces that blend
 * API-derived vs manual/AI estimates must call weightedEstimate().
 */

export const PREDICTION_WEIGHTS = {
  apiDb: 0.6,
  manualAi: 0.4,
} as const;

export type BlendSource = "blended" | "api_only" | "manual_ai_only";

export type WeightedEstimateResult = {
  value: number;
  source: BlendSource;
  apiWeight: number;
  manualAiWeight: number;
};

function isFiniteNum(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

/**
 * Canonical 60/40 blend. Prefer API-DB when both sides exist.
 * Missing-side fallback: use the available side at 100% (never invent).
 */
export function weightedEstimate(
  apiDerived: number | null | undefined,
  manualAi: number | null | undefined
): WeightedEstimateResult | null {
  const hasApi = isFiniteNum(apiDerived);
  const hasManual = isFiniteNum(manualAi);

  if (hasApi && hasManual) {
    const value =
      PREDICTION_WEIGHTS.apiDb * apiDerived +
      PREDICTION_WEIGHTS.manualAi * manualAi;
    return {
      value,
      source: "blended",
      apiWeight: PREDICTION_WEIGHTS.apiDb,
      manualAiWeight: PREDICTION_WEIGHTS.manualAi,
    };
  }

  if (hasApi) {
    console.warn(
      "[prediction-weights] manual/AI missing — using 100% API-DB estimate"
    );
    return {
      value: apiDerived,
      source: "api_only",
      apiWeight: 1,
      manualAiWeight: 0,
    };
  }

  if (hasManual) {
    console.warn(
      "[prediction-weights] API-DB missing — using 100% Manual/AI estimate"
    );
    return {
      value: manualAi,
      source: "manual_ai_only",
      apiWeight: 0,
      manualAiWeight: 1,
    };
  }

  return null;
}

export function blendBadgeLabel(source: BlendSource): string {
  switch (source) {
    case "blended":
      return `API ${Math.round(PREDICTION_WEIGHTS.apiDb * 100)}% · Manual/AI ${Math.round(PREDICTION_WEIGHTS.manualAi * 100)}%`;
    case "api_only":
      return "API only";
    case "manual_ai_only":
      return "Manual/AI only";
  }
}

export function blendBadgeTitle(source: BlendSource): string {
  switch (source) {
    case "blended":
      return "Blended estimate: API-DB history/Poisson (hist_*, live_*) weighted 60%; AI learner + manual signals weighted 40%.";
    case "api_only":
      return "API-DB only — Manual/AI side missing for this match; no invented manual numbers.";
    case "manual_ai_only":
      return "Manual/AI only — API-DB history missing for this match; no invented API numbers.";
  }
}
