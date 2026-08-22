import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import {
  PREDICTION_WEIGHTS,
} from "@/lib/prediction-log/prediction-weights";
import { isSystemSeasonBlendEnabled } from "@/lib/system-season/feature-flags";
import { TARGET_API_WEIGHT, TARGET_SYSTEM_WEIGHT } from "./config";
import type { SourceCoverageSnapshot } from "./types";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Quality scores q_A, q_S in [0,1] from CFE provenance. */
export function computeSourceQuality(cfe: CanonicalFixtureEstimate): {
  qApi: number;
  qSystem: number;
} {
  const p = cfe.provenance;
  const essNorm = clamp01(p.ess / 40);
  const matchNorm = clamp01(p.matches_used / 30);
  const seasonNorm = clamp01(p.seasons_used / 4);

  const apiBase =
    p.sourceBreakdown === "api_only"
      ? 1
      : p.sourceBreakdown === "blended"
        ? clamp01(p.api_pct / 100)
        : 0.2;
  const systemBase =
    p.sourceBreakdown === "manual_ai_only"
      ? 1
      : p.sourceBreakdown === "blended"
        ? clamp01((p.manual_pct + p.ai_pct) / 100)
        : 0.2;

  const systemSeasonBoost =
    isSystemSeasonBlendEnabled() && p.sourceBreakdown === "blended" ? 0.1 : 0;

  const qApi = clamp01(apiBase * (0.5 * essNorm + 0.3 * matchNorm + 0.2 * seasonNorm));
  const qSystem = clamp01(
    (systemBase + systemSeasonBoost) *
      (0.5 * essNorm + 0.3 * matchNorm + 0.2 * seasonNorm)
  );
  return { qApi, qSystem };
}

export function computeEffectiveWeights(
  qApi: number,
  qSystem: number
): { wApi: number; wSystem: number } {
  const num = TARGET_API_WEIGHT * qApi + TARGET_SYSTEM_WEIGHT * qSystem;
  if (num <= 0) {
    if (qApi > 0) return { wApi: 1, wSystem: 0 };
    if (qSystem > 0) return { wApi: 0, wSystem: 1 };
    return { wApi: 0, wSystem: 0 };
  }
  return {
    wApi: (TARGET_API_WEIGHT * qApi) / num,
    wSystem: (TARGET_SYSTEM_WEIGHT * qSystem) / num,
  };
}

export function buildSourceCoverage(
  cfe: CanonicalFixtureEstimate,
  exclusionReasons: string[] = []
): SourceCoverageSnapshot {
  const { qApi, qSystem } = computeSourceQuality(cfe);
  const { wApi, wSystem } = computeEffectiveWeights(qApi, qSystem);
  const p = cfe.provenance;

  return {
    targetApiWeight: PREDICTION_WEIGHTS.apiDb,
    targetSystemWeight: PREDICTION_WEIGHTS.manualAi,
    effectiveApiWeight: wApi,
    effectiveSystemWeight: wSystem,
    qApi,
    qSystem,
    apiRecordCount: p.sourceBreakdown !== "manual_ai_only" ? p.matches_used : null,
    systemRecordCount:
      p.sourceBreakdown !== "api_only" ? Math.round(p.ess) : null,
    effectiveSampleSize: p.ess,
    sourceBreakdown: p.sourceBreakdown,
    exclusionCount: exclusionReasons.length,
    exclusionReasons,
  };
}

export function coverageLabel(cov: SourceCoverageSnapshot): string {
  const apiPct = Math.round(cov.effectiveApiWeight * 100);
  const sysPct = Math.round(cov.effectiveSystemWeight * 100);
  if (isSystemSeasonBlendEnabled()) {
    return `Prior API ${apiPct}% / System season ${sysPct}%`;
  }
  return `API ${apiPct}% / System ${sysPct}%`;
}
