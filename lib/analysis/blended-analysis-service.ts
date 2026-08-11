/**
 * BlendedAnalysisService — sits on top of legacy analysis results.
 * Flag OFF → callers use legacy only (this module is a no-op helper).
 * Flag ON → returns { legacy, blended } with provenance + quality.
 */

import { getBlendConfig, type BlendConfig } from "./blend-config";
import {
  blendNumericKpi,
  computeBlendConfidence,
  type BlendStatus,
} from "./blend-math";
import { isAnalysisBlendedModeEnabled } from "./feature-flags";
import type { DateRange, SourceGroupSummary } from "./source-groups";

export type SourceSideBreakdown = {
  configuredWeight: number;
  effectiveWeight: number;
  recordCount: number;
  dateRange: DateRange;
};

export type BlendedPayload<M extends Record<string, number | null | undefined>> =
  {
    enabled: boolean;
    status: BlendStatus;
    metrics: Partial<M>;
    sourceBreakdown: {
      api: SourceSideBreakdown;
      system: SourceSideBreakdown;
    };
    quality: {
      confidence: number;
      warnings: string[];
    };
    calculationVersion: string;
    fallbackReason: string | null;
  };

export type BlendedAnalysisResult<
  T,
  M extends Record<string, number | null | undefined> = Record<
    string,
    number | null | undefined
  >,
> = {
  legacy: T;
  blended: BlendedPayload<M>;
};

export type BlendMetricPair<K extends string> = {
  key: K;
  api: number | null | undefined;
  system: number | null | undefined;
};

function emptyDateRange(): DateRange {
  return { from: null, to: null };
}

function sideFromSummary(
  summary: SourceGroupSummary | undefined,
  configuredWeight: number,
  effectiveWeight: number
): SourceSideBreakdown {
  return {
    configuredWeight,
    effectiveWeight,
    recordCount: summary?.recordCount ?? 0,
    dateRange: summary?.dateRange ?? emptyDateRange(),
  };
}

/**
 * Wrap a legacy result with optional blended metrics.
 * When blended mode is disabled, blended.enabled=false and metrics empty.
 */
export function buildBlendedAnalysisResult<
  T,
  M extends Record<string, number | null | undefined>,
>(input: {
  legacy: T;
  /** Numeric KPIs to blend independently (same key on api/system). */
  metrics: Array<BlendMetricPair<Extract<keyof M, string>>>;
  apiSummary?: SourceGroupSummary;
  systemSummary?: SourceGroupSummary;
  config?: BlendConfig;
  /** Extra warnings (e.g. unknown provenance excluded). */
  extraWarnings?: string[];
}): BlendedAnalysisResult<T, M> {
  const config = input.config ?? getBlendConfig();
  const enabled = isAnalysisBlendedModeEnabled();

  if (!enabled) {
    return {
      legacy: input.legacy,
      blended: {
        enabled: false,
        status: "unavailable",
        metrics: {},
        sourceBreakdown: {
          api: sideFromSummary(input.apiSummary, config.apiWeight, 0),
          system: sideFromSummary(input.systemSummary, config.systemWeight, 0),
        },
        quality: { confidence: 0, warnings: [] },
        calculationVersion: config.calculationVersion,
        fallbackReason: "ANALYSIS_BLENDED_MODE_ENABLED=false",
      },
    };
  }

  const warnings = [...(input.extraWarnings ?? [])];
  const apiCount = input.apiSummary?.recordCount ?? 0;
  const sysCount = input.systemSummary?.recordCount ?? 0;

  if (input.apiSummary?.excludedUnknown) {
    warnings.push(
      `Excluded ${input.apiSummary.excludedUnknown} unknown-provenance API-side record(s)`
    );
  }
  if (input.systemSummary?.excludedUnknown) {
    warnings.push(
      `Excluded ${input.systemSummary.excludedUnknown} unknown-provenance system record(s)`
    );
  }

  const metricsOut: Partial<M> = {};
  let worst: BlendStatus = "complete";
  let apiEff = config.apiWeight;
  let sysEff = config.systemWeight;
  let anyComplete = false;

  for (const m of input.metrics) {
    const r = blendNumericKpi(m.api, m.system, config, {
      apiRecordCount: apiCount,
      systemRecordCount: sysCount,
      minApiRecords: config.minApiRecords,
      minSystemRecords: config.minSystemRecords,
    });
    for (const w of r.warnings) {
      if (!warnings.includes(w)) warnings.push(w);
    }
    if (r.status === "unavailable") worst = "unavailable";
    else if (r.status === "partial" && worst === "complete") worst = "partial";
    if (r.status === "complete" || r.status === "partial") {
      anyComplete = true;
      apiEff = r.apiEffectiveWeight;
      sysEff = r.systemEffectiveWeight;
      if (r.value != null) {
        (metricsOut as Record<string, number>)[m.key] = r.value;
      }
    }
  }

  if (input.metrics.length === 0) {
    worst = "unavailable";
    warnings.push("No blendable metrics supplied");
  } else if (!anyComplete && worst !== "unavailable") {
    worst = "unavailable";
  }

  // Default safe: if unavailable under legacy fallback, do not claim blended metrics.
  if (worst === "unavailable" && config.fallbackMode === "legacy") {
    for (const k of Object.keys(metricsOut)) {
      delete (metricsOut as Record<string, unknown>)[k];
    }
    apiEff = 0;
    sysEff = 0;
  }

  const confidence = computeBlendConfidence({
    apiRecordCount: apiCount,
    systemRecordCount: sysCount,
    minApiRecords: config.minApiRecords,
    minSystemRecords: config.minSystemRecords,
    status: worst,
  });

  let fallbackReason: string | null = null;
  if (worst === "unavailable") {
    fallbackReason =
      warnings.find((w) => /fallback|lack|below/i.test(w)) ??
      "Insufficient source data for trustworthy blend";
  }

  return {
    legacy: input.legacy,
    blended: {
      enabled: true,
      status: worst,
      metrics: metricsOut,
      sourceBreakdown: {
        api: sideFromSummary(input.apiSummary, config.apiWeight, apiEff),
        system: sideFromSummary(
          input.systemSummary,
          config.systemWeight,
          sysEff
        ),
      },
      quality: { confidence, warnings },
      calculationVersion: config.calculationVersion,
      fallbackReason,
    },
  };
}

/**
 * Safe wrapper: on throw, return legacy with unavailable blended + error warning.
 */
export function safeBuildBlendedAnalysisResult<
  T,
  M extends Record<string, number | null | undefined>,
>(
  input: Parameters<typeof buildBlendedAnalysisResult<T, M>>[0]
): BlendedAnalysisResult<T, M> {
  try {
    return buildBlendedAnalysisResult(input);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[blended-analysis] failed — using legacy only:", msg);
    const config = input.config ?? getBlendConfig();
    return {
      legacy: input.legacy,
      blended: {
        enabled: isAnalysisBlendedModeEnabled(),
        status: "unavailable",
        metrics: {},
        sourceBreakdown: {
          api: sideFromSummary(input.apiSummary, config.apiWeight, 0),
          system: sideFromSummary(input.systemSummary, config.systemWeight, 0),
        },
        quality: {
          confidence: 0,
          warnings: [`Blended analysis error: ${msg}`],
        },
        calculationVersion: config.calculationVersion,
        fallbackReason: msg,
      },
    };
  }
}

/** True when UI should present blended metrics as primary. */
export function shouldDisplayBlended(
  blended: BlendedPayload<Record<string, number | null | undefined>>
): boolean {
  return blended.enabled && blended.status === "complete";
}
