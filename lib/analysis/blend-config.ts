/**
 * Configurable blend weights and quality thresholds.
 * Do not hard-code mins across pages — read from here / env.
 */

import { PREDICTION_WEIGHTS } from "@/lib/prediction-log/prediction-weights";

export type BlendFallbackMode = "legacy" | "normalize_effective_weights";

export type BlendConfig = {
  apiWeight: number;
  systemWeight: number;
  minApiRecords: number;
  minSystemRecords: number;
  /** Days; 0 = no recency gate. */
  maxAgeDays: number;
  fallbackMode: BlendFallbackMode;
  calculationVersion: string;
};

export const BLEND_CALCULATION_VERSION = "blended-analysis-v1";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFallbackMode(): BlendFallbackMode {
  const raw = (process.env.ANALYSIS_BLENDED_FALLBACK_MODE ?? "legacy")
    .trim()
    .toLowerCase();
  if (raw === "normalize_effective_weights" || raw === "normalize") {
    return "normalize_effective_weights";
  }
  return "legacy";
}

export function getBlendConfig(): BlendConfig {
  return {
    apiWeight: PREDICTION_WEIGHTS.apiDb,
    systemWeight: PREDICTION_WEIGHTS.manualAi,
    minApiRecords: envInt("ANALYSIS_BLENDED_MIN_API_RECORDS", 8),
    minSystemRecords: envInt("ANALYSIS_BLENDED_MIN_SYSTEM_RECORDS", 5),
    maxAgeDays: envInt("ANALYSIS_BLENDED_MAX_AGE_DAYS", 0),
    fallbackMode: envFallbackMode(),
    calculationVersion: BLEND_CALCULATION_VERSION,
  };
}
