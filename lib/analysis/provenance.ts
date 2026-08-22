/**
 * Analysis record provenance — store-inferred; never guess silently.
 * unknown → exclude from blended result and report a warning.
 */

import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";

export type AnalysisProvenance =
  | "api_historical"
  | "manual_batch"
  | "system_historical"
  | "system_season_corpus"
  | "ai_learner"
  | "unknown";

export type ProvenanceStoreHint =
  | "hist_table"
  | "hist_derived"
  | "seed_baseline"
  | "learner_aggregate"
  | "kv_batch"
  | "livescore_bulk"
  | "other";

/** Classify a Prediction Log batch corpus (not settlement fill channel). */
export function classifyBatchProvenance(
  batch: Pick<PredictionBatch, "batchKind" | "bulkScrapeMeta" | "source">
): AnalysisProvenance {
  if (batch.bulkScrapeMeta?.source === "livescore-bulk") {
    return "system_historical";
  }
  if (batch.batchKind === "recommended") {
    // Derived of parent — not a historical corpus for blending.
    return "unknown";
  }
  if (batch.batchKind === "manual" || batch.batchKind == null) {
    // Legacy batches without batchKind treated as manual tips when no bulk meta.
    return "manual_batch";
  }
  return "unknown";
}

/**
 * Match-level settlement channel is NOT corpus class.
 * api-football fill on a manual batch stays manual_batch at batch level.
 */
export function classifyMatchSettlementNote(
  match: Pick<LogMatch, "resultSource">
): string | null {
  if (!match.resultSource) return null;
  return `settlement_fill=${match.resultSource}`;
}

export function classifyStoreHint(hint: ProvenanceStoreHint): AnalysisProvenance {
  switch (hint) {
    case "hist_table":
    case "hist_derived":
      return "api_historical";
    case "seed_baseline":
    case "livescore_bulk":
      return "system_historical";
    case "learner_aggregate":
      return "ai_learner";
    case "kv_batch":
      return "manual_batch";
    default:
      return "unknown";
  }
}

/** System group (40%): manual + system_historical + ai_learner. */
export function isSystemGroupProvenance(p: AnalysisProvenance): boolean {
  return (
    p === "manual_batch" ||
    p === "system_historical" ||
    p === "system_season_corpus" ||
    p === "ai_learner"
  );
}

export function isApiGroupProvenance(p: AnalysisProvenance): boolean {
  return p === "api_historical";
}

export function isBlendEligible(p: AnalysisProvenance): boolean {
  return p !== "unknown";
}
