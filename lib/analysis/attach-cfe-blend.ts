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
  type SourceGroupSummary,
} from "./source-groups";

export type CfeBlendMetrics = {
  lambdaHome: number;
  lambdaAway: number;
};

export type CanonicalFixtureEstimateWithBlend = CanonicalFixtureEstimate & {
  analysisBlend?: BlendedPayload<CfeBlendMetrics>;
};

function fallbackSystemSummary(batches: PredictionBatch[]): SourceGroupSummary {
  const systemInfo = countValidSystemMatchRecords(batches);
  return {
    recordCount: systemInfo.count,
    dateRange: systemInfo.dateRange,
    byProvenance: { manual_batch: systemInfo.count },
    excludedUnknown: systemInfo.unknownBatches,
  };
}

/**
 * After legacy CFE is computed, optionally attach provenance envelope.
 * Does not alter lambdas/markets when flag off or status !== complete.
 */
export function attachCfeBlendedEnvelope(
  legacy: CanonicalFixtureEstimate,
  batches: PredictionBatch[],
  opts?: {
    /** System-side λ (2026/27 system season when blend flag on). */
    manualHome?: number | null;
    manualAway?: number | null;
    /** Pre-resolved system group (async callers). */
    systemSummary?: SourceGroupSummary;
  }
): CanonicalFixtureEstimateWithBlend {
  if (!isAnalysisBlendedModeEnabled()) {
    return legacy;
  }

  try {
    const systemSummary = opts?.systemSummary ?? fallbackSystemSummary(batches);
    const apiSummary = apiGroupFromHistSamples({
      matchesUsed: legacy.provenance.matches_used,
    });

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
        systemSummary.excludedUnknown > 0
          ? [
              `Excluded ${systemSummary.excludedUnknown} unknown/recommended batch(es) from system group`,
            ]
          : undefined,
    });

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

/** Async variant — resolves system_season corpus when blend flag on. */
export async function attachCfeBlendedEnvelopeAsync(
  legacy: CanonicalFixtureEstimate,
  batches: PredictionBatch[],
  opts?: {
    manualHome?: number | null;
    manualAway?: number | null;
    league?: string;
  }
): Promise<CanonicalFixtureEstimateWithBlend> {
  if (!isAnalysisBlendedModeEnabled()) {
    return legacy;
  }

  const { resolveSystemGroupSummary } = await import("./source-groups");
  const systemSummary = await resolveSystemGroupSummary(batches, opts?.league);
  const { unknownBatches: _u, ...summary } = systemSummary;

  return attachCfeBlendedEnvelope(legacy, batches, {
    ...opts,
    systemSummary: summary,
  });
}
