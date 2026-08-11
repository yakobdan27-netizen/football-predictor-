/**
 * Metric-type-aware 60/40 combiners.
 * Reuses weightedEstimate for numeric KPIs — never invent zeros for missing sides.
 */

import {
  weightedEstimate,
  type WeightedEstimateResult,
} from "@/lib/prediction-log/prediction-weights";
import type { BlendConfig, BlendFallbackMode } from "./blend-config";

export type BlendStatus = "complete" | "partial" | "unavailable";

export type NumericBlendResult = {
  value: number | null;
  status: BlendStatus;
  apiEffectiveWeight: number;
  systemEffectiveWeight: number;
  warnings: string[];
  underlying: WeightedEstimateResult | null;
};

function isFiniteNum(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

/**
 * Blend rates / λ / comparable KPIs.
 * Both present → exact configured weights.
 * One missing → never treat as 0; legacy fallback or normalize per config.
 */
export function blendNumericKpi(
  apiMetric: number | null | undefined,
  systemMetric: number | null | undefined,
  config: Pick<
    BlendConfig,
    "apiWeight" | "systemWeight" | "fallbackMode"
  >,
  opts?: {
    apiRecordCount?: number;
    systemRecordCount?: number;
    minApiRecords?: number;
    minSystemRecords?: number;
  }
): NumericBlendResult {
  const warnings: string[] = [];
  const minApi = opts?.minApiRecords ?? 0;
  const minSys = opts?.minSystemRecords ?? 0;
  const apiCount = opts?.apiRecordCount ?? (isFiniteNum(apiMetric) ? minApi : 0);
  const sysCount =
    opts?.systemRecordCount ?? (isFiniteNum(systemMetric) ? minSys : 0);

  const apiOk = isFiniteNum(apiMetric) && apiCount >= minApi;
  const sysOk = isFiniteNum(systemMetric) && sysCount >= minSys;

  if (apiOk && sysOk) {
    const underlying = weightedEstimate(apiMetric, systemMetric);
    return {
      value: underlying?.value ?? null,
      status: "complete",
      apiEffectiveWeight: config.apiWeight,
      systemEffectiveWeight: config.systemWeight,
      warnings,
      underlying,
    };
  }

  if (!apiOk && !sysOk) {
    warnings.push("Both API and system groups lack sufficient valid data");
    return {
      value: null,
      status: "unavailable",
      apiEffectiveWeight: 0,
      systemEffectiveWeight: 0,
      warnings,
      underlying: null,
    };
  }

  const mode: BlendFallbackMode = config.fallbackMode;

  if (mode === "normalize_effective_weights") {
    if (apiOk && isFiniteNum(apiMetric)) {
      warnings.push(
        "System group below threshold — normalized to 100% API (partial)"
      );
      return {
        value: apiMetric,
        status: "partial",
        apiEffectiveWeight: 1,
        systemEffectiveWeight: 0,
        warnings,
        underlying: {
          value: apiMetric,
          source: "api_only",
          apiWeight: 1,
          manualAiWeight: 0,
        },
      };
    }
    if (sysOk && isFiniteNum(systemMetric)) {
      warnings.push(
        "API group below threshold — normalized to 100% system (partial)"
      );
      return {
        value: systemMetric,
        status: "partial",
        apiEffectiveWeight: 0,
        systemEffectiveWeight: 1,
        warnings,
        underlying: {
          value: systemMetric,
          source: "manual_ai_only",
          apiWeight: 0,
          manualAiWeight: 1,
        },
      };
    }
  }

  // Default safe: legacy fallback — do not emit a trustworthy blended value.
  if (!apiOk) {
    warnings.push(
      "API group below minimum quality — falling back to legacy result"
    );
  }
  if (!sysOk) {
    warnings.push(
      "System group below minimum quality — falling back to legacy result"
    );
  }
  return {
    value: null,
    status: "unavailable",
    apiEffectiveWeight: 0,
    systemEffectiveWeight: 0,
    warnings,
    underlying: null,
  };
}

/** Counts: never weighted; return both sides + deduped total. */
export function combineCounts(
  apiCount: number,
  systemCount: number,
  dedupedTotal: number
): {
  api: number;
  system: number;
  combinedDeduped: number;
} {
  return {
    api: apiCount,
    system: systemCount,
    combinedDeduped: dedupedTotal,
  };
}

/**
 * Confidence from volume/recency/completeness — not from 60/40 weights.
 * Returns 0–1.
 */
export function computeBlendConfidence(input: {
  apiRecordCount: number;
  systemRecordCount: number;
  minApiRecords: number;
  minSystemRecords: number;
  status: BlendStatus;
  consistencyScore?: number; // 0–1 optional
}): number {
  if (input.status === "unavailable") return 0;
  const apiShare = Math.min(
    1,
    input.apiRecordCount / Math.max(1, input.minApiRecords)
  );
  const sysShare = Math.min(
    1,
    input.systemRecordCount / Math.max(1, input.minSystemRecords)
  );
  const volume = 0.5 * apiShare + 0.5 * sysShare;
  const consistency =
    input.consistencyScore != null && Number.isFinite(input.consistencyScore)
      ? Math.max(0, Math.min(1, input.consistencyScore))
      : 0.8;
  const partialPenalty = input.status === "partial" ? 0.75 : 1;
  return Math.max(0, Math.min(1, volume * consistency * partialPenalty));
}

/** Sample-weighted mean for system group (no invented sub-weights). */
export function aggregateSampleWeightedMean(
  values: Array<{ value: number; n: number }>
): { mean: number | null; totalN: number } {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (!Number.isFinite(v.value) || !(v.n > 0)) continue;
    sum += v.value * v.n;
    n += v.n;
  }
  if (n <= 0) return { mean: null, totalN: 0 };
  return { mean: sum / n, totalN: n };
}
