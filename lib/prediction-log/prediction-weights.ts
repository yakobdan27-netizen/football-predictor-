/**
 * Canonical prediction blend: 60% API-DB · 40% Manual/AI.
 * Supersedes any 50/50 hybrid. All analysis surfaces that blend
 * API-derived vs manual/AI estimates must call weightedEstimate().
 */

export const PREDICTION_WEIGHTS = {
  apiDb: 0.6,
  manualAi: 0.4,
} as const;

/** System-season blend: 30% last-5 MC · 30% prior API · 40% system_season. */
export const SYSTEM_SEASON_BLEND_WEIGHTS = {
  recentLast5: 0.3,
  priorApi: 0.3,
  systemSeason: 0.4,
} as const;

export type BlendSource = "blended" | "api_only" | "manual_ai_only";

export type WeightedEstimateResult = {
  value: number;
  source: BlendSource;
  apiWeight: number;
  manualAiWeight: number;
};

export type WeightedTripleEstimateResult = {
  value: number;
  source: BlendSource;
  recentWeight: number;
  priorWeight: number;
  systemWeight: number;
  /** Combined API-side weight (recent + prior) for legacy provenance fields. */
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

type TripleSide = { value: number; weight: number };

/**
 * 30/30/40 system-season blend at λ level.
 * Missing sides renormalize over available weights — never invent zeros.
 */
export function weightedTripleEstimate(
  recent: number | null | undefined,
  prior: number | null | undefined,
  system: number | null | undefined
): WeightedTripleEstimateResult | null {
  const sides: TripleSide[] = [];
  if (isFiniteNum(recent)) {
    sides.push({
      value: recent,
      weight: SYSTEM_SEASON_BLEND_WEIGHTS.recentLast5,
    });
  }
  if (isFiniteNum(prior)) {
    sides.push({
      value: prior,
      weight: SYSTEM_SEASON_BLEND_WEIGHTS.priorApi,
    });
  }
  if (isFiniteNum(system)) {
    sides.push({
      value: system,
      weight: SYSTEM_SEASON_BLEND_WEIGHTS.systemSeason,
    });
  }

  if (sides.length === 0) return null;

  const weightSum = sides.reduce((s, x) => s + x.weight, 0);
  const blended = sides.reduce((s, x) => s + x.weight * x.value, 0) / weightSum;

  const recentW = isFiniteNum(recent)
    ? SYSTEM_SEASON_BLEND_WEIGHTS.recentLast5 / weightSum
    : 0;
  const priorW = isFiniteNum(prior)
    ? SYSTEM_SEASON_BLEND_WEIGHTS.priorApi / weightSum
    : 0;
  const systemW = isFiniteNum(system)
    ? SYSTEM_SEASON_BLEND_WEIGHTS.systemSeason / weightSum
    : 0;
  const apiW = recentW + priorW;

  let source: BlendSource = "blended";
  if (sides.length === 1) {
    source = isFiniteNum(system) ? "manual_ai_only" : "api_only";
  } else if (!isFiniteNum(system)) {
    source = "api_only";
  } else if (!isFiniteNum(recent) && !isFiniteNum(prior)) {
    source = "manual_ai_only";
  }

  return {
    value: blended,
    source,
    recentWeight: recentW,
    priorWeight: priorW,
    systemWeight: systemW,
    apiWeight: apiW,
    manualAiWeight: systemW,
  };
}

export function blendTripleBadgeLabel(): string {
  const w = SYSTEM_SEASON_BLEND_WEIGHTS;
  return `Last 5 ${Math.round(w.recentLast5 * 100)}% · Prior API ${Math.round(w.priorApi * 100)}% · System ${Math.round(w.systemSeason * 100)}%`;
}

export function blendTripleBadgeTitle(): string {
  return "Blended estimate: 30% last-five Match Centre results, 30% prior API history, and 40% auto-collected 2026/27 system-season results.";
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
      return "Blended estimate: 60% prior API history (hist / seed seasons before 2026/27) and 40% auto-collected 2026/27 system-season results.";
    case "api_only":
      return "Prior API history only — current-season system corpus missing for this match.";
    case "manual_ai_only":
      return "2026/27 system-season only — prior API history missing for this match.";
  }
}
