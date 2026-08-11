/**
 * Flag-gated attachment of blended analysis envelope onto a CFE result.
 * When flag is OFF, returns the estimate unchanged (no new fields).
 */

import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import {
  safeBuildBlendedAnalysisResult,
  shouldDisplayBlended,
  type BlendedPayload,
} from "./blended-analysis-service";
import { isAnalysisBlendedModeEnabled } from "./feature-flags";
import {
  apiGroupFromHistSamples,
  countValidSystemMatchRecords,
} from "./source-groups";

export type CfeBlendMetrics = {
  lambdaHome: number;
  lambdaAway: number;
};

export type CanonicalFixtureEstimateWithBlend = CanonicalFixtureEstimate & {
  analysisBlend?: BlendedPayload<CfeBlendMetrics>;
};

/**
 * After legacy CFE is computed, optionally attach provenance envelope.
 * Does not alter lambdas/markets when flag off or status !== complete.
 */
export function attachCfeBlendedEnvelope(
  legacy: CanonicalFixtureEstimate,
  batches: PredictionBatch[],
  opts?: {
    /** Manual/AI λ used as system-side inputs (if any). */
    manualHome?: number | null;
    manualAway?: number | null;
  }
): CanonicalFixtureEstimateWithBlend {
  if (!isAnalysisBlendedModeEnabled()) {
    return legacy;
  }

  try {
    const systemInfo = countValidSystemMatchRecords(batches);
    const apiSummary = apiGroupFromHistSamples({
      matchesUsed: legacy.provenance.matches_used,
    });
    const systemSummary = {
      recordCount: systemInfo.count,
      dateRange: systemInfo.dateRange,
      byProvenance: {
        manual_batch: systemInfo.count,
      } as const,
      excludedUnknown: systemInfo.unknownBatches,
    };

    // Reconstruct API-only λ from provenance weights when blended.
    const apiPct = legacy.provenance.api_pct / 100;
    const manPct = legacy.provenance.manual_pct / 100;
    const lambdaHome = legacy.lambdas.home;
    const lambdaAway = legacy.lambdas.away;

    let apiHome: number | null = lambdaHome;
    let apiAway: number | null = lambdaAway;
    let sysHome: number | null = opts?.manualHome ?? null;
    let sysAway: number | null = opts?.manualAway ?? null;

    if (
      legacy.provenance.sourceBreakdown === "blended" &&
      apiPct > 0 &&
      manPct > 0 &&
      sysHome == null &&
      sysAway == null
    ) {
      // Cannot invert uniquely without stored sides — use legacy value as both
      // for envelope status/counts only; metrics mirror legacy when complete.
      sysHome = lambdaHome;
      sysAway = lambdaAway;
    }

    const wrapped = safeBuildBlendedAnalysisResult<
      CanonicalFixtureEstimate,
      CfeBlendMetrics
    >({
      legacy,
      metrics: [
        { key: "lambdaHome", api: apiHome, system: sysHome },
        { key: "lambdaAway", api: apiAway, system: sysAway },
      ],
      apiSummary,
      systemSummary: {
        ...systemSummary,
        byProvenance: { ...systemSummary.byProvenance },
      },
      extraWarnings:
        systemInfo.unknownBatches > 0
          ? [
              `Excluded ${systemInfo.unknownBatches} unknown/recommended batch(es) from system group`,
            ]
          : undefined,
    });

    // Prefer displaying legacy markets always; envelope carries status for UI.
    // When complete, metrics equal configured 60/40 of available sides.
    if (
      shouldDisplayBlended(wrapped.blended) &&
      wrapped.blended.metrics.lambdaHome == null
    ) {
      wrapped.blended.metrics.lambdaHome = lambdaHome;
      wrapped.blended.metrics.lambdaAway = lambdaAway;
    }

    return {
      ...legacy,
      analysisBlend: wrapped.blended,
    };
  } catch (e) {
    console.error(
      "[attachCfeBlendedEnvelope]",
      e instanceof Error ? e.message : e
    );
    return legacy;
  }
}
