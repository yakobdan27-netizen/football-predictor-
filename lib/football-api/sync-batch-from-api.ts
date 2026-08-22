/**
 * Batch-level API result fill for Prediction Log (replaces Livescore scrape fill).
 */
import { loadBatch, loadAllBatches } from "@/lib/prediction-log/club-store";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import {
  runApiFillPass,
  DEFAULT_MAX_MATCHES_PER_PASS,
  DEFAULT_TIME_BUDGET_MS,
} from "./sync-batch-api-fill";
import {
  batchDateIsPastOrToday,
  persistUpdatedBatch,
  recomputeGlobalStoresAfterBatchUpdates,
  scoreBatchWithUpdatedMatches,
} from "./sync-batch-persist";

export interface SyncBatchFromApiSummary {
  filled: number;
  enriched: number;
  failed: number;
  remaining: string[];
  errors: string[];
  unavailable?: boolean;
  batch?: PredictionBatch;
}

export async function syncBatchFromApi(
  batchId: string,
  options?: { matchIds?: string[]; maxMatches?: number }
): Promise<SyncBatchFromApiSummary> {
  const summary: SyncBatchFromApiSummary = {
    filled: 0,
    enriched: 0,
    failed: 0,
    remaining: [],
    errors: [],
  };

  let batch: PredictionBatch;
  try {
    const loaded = await loadBatch(batchId);
    if (!loaded) {
      summary.errors.push(`Batch not found: ${batchId}`);
      return summary;
    }
    batch = loaded;
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    summary.unavailable = true;
    return summary;
  }

  if (!batchDateIsPastOrToday(batch.date)) {
    summary.errors.push("Batch date is in the future; skipping API fill.");
    summary.batch = batch;
    return summary;
  }

  const idFilter = options?.matchIds?.length ? new Set(options.matchIds) : undefined;
  const pass = await runApiFillPass([batch], {
    batchId,
    matchIds: idFilter,
    maxMatches: options?.maxMatches ?? DEFAULT_MAX_MATCHES_PER_PASS,
    timeBudgetMs: DEFAULT_TIME_BUDGET_MS,
  });

  summary.filled = pass.filled;
  summary.enriched = pass.enriched;
  summary.failed = pass.failed;
  summary.remaining = pass.remaining;
  summary.errors = pass.errors;
  summary.unavailable = pass.unavailable;

  const state = pass.updatedBatches.get(batchId);
  if (!state) {
    summary.batch = batch;
    return summary;
  }

  try {
    const updatedBatch = scoreBatchWithUpdatedMatches(
      state.batch,
      state.batch.matches.map((m) => state.byId.get(m.id) ?? m)
    );
    summary.batch = await persistUpdatedBatch(updatedBatch);
    await recomputeGlobalStoresAfterBatchUpdates();
  } catch (e) {
    summary.errors.push(
      `Failed to save batch: ${e instanceof Error ? e.message : String(e)}`
    );
    summary.batch = batch;
  }

  return summary;
}
