/**
 * Unified Prediction Log API fill: trace → live DB merge → API enrich pass.
 */
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { batchNeedsResults } from "@/lib/prediction-log/scoring";
import { matchNeedsApiDetailFill } from "@/lib/football-api/map-fixture-to-match";
import {
  matchNeedsNamePairTrace,
  type TraceStatusCounts,
} from "@/lib/prediction-log/result-trace";
import { syncPredictionLogFromLiveFixtures } from "@/lib/prediction-log/sync-from-live-fixtures";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import {
  runApiFillPass,
  DEFAULT_MAX_MATCHES_PER_PASS,
  DEFAULT_TIME_BUDGET_MS,
} from "./sync-batch-api-fill";
import {
  persistUpdatedBatch,
  scoreBatchWithUpdatedMatches,
} from "./sync-batch-persist";
import { tracePendingMatchResults } from "./trace-fixture-by-pair";
import type { SyncResultsSummary } from "./sync-prediction-log";

export type SyncAllPredictionLogSummary = SyncResultsSummary & {
  filled: number;
  enriched: number;
  failed: number;
  remaining: string[];
  liveMerged: number;
  liveUpdatedBatches: number;
  archivedBatchIds: string[];
};

export async function syncAllPredictionLogFromApi(opts?: {
  batchId?: string;
  maxMatches?: number;
  timeBudgetMs?: number;
  skipTrace?: boolean;
  skipLive?: boolean;
}): Promise<SyncAllPredictionLogSummary> {
  const started = Date.now();
  const timeBudgetMs = opts?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const maxMatches = opts?.maxMatches ?? DEFAULT_MAX_MATCHES_PER_PASS;

  const emptyTrace: TraceStatusCounts = {
    pending: 0,
    foundNotFinal: 0,
    filled: 0,
    ambiguous: 0,
    needsReview: 0,
    retry: 0,
  };

  let traceSummary = {
    updatedBatches: 0,
    matchesSynced: 0,
    matchesNotFound: 0,
    errors: [] as string[],
    conflicts: [] as SyncResultsSummary["conflicts"],
    unavailable: false as boolean | undefined,
    trace: emptyTrace,
    archivedBatchIds: [] as string[],
  };

  if (!opts?.skipTrace) {
    const traced = await tracePendingMatchResults({ batchId: opts?.batchId });
    traceSummary = {
      updatedBatches: traced.updatedBatches,
      matchesSynced: traced.matchesSynced,
      matchesNotFound: traced.matchesNotFound,
      errors: traced.errors,
      conflicts: traced.conflicts,
      unavailable: traced.unavailable,
      trace: traced.trace,
      archivedBatchIds: traced.archivedBatchIds,
    };
    if (traceSummary.unavailable) {
      return {
        ...traceSummary,
        filled: traceSummary.matchesSynced,
        enriched: 0,
        failed: 0,
        remaining: [],
        liveMerged: 0,
        liveUpdatedBatches: 0,
        archivedBatchIds: [],
      };
    }
  }

  let liveMerged = 0;
  let liveUpdatedBatches = 0;
  let liveArchivedBatchIds: string[] = [];
  const liveErrors: string[] = [];

  if (!opts?.skipLive) {
    const live = await syncPredictionLogFromLiveFixtures({
      batchId: opts?.batchId,
    });
    liveMerged = live.matchesMerged;
    liveUpdatedBatches = live.updatedBatches;
    liveArchivedBatchIds = live.archivedBatchIds;
    liveErrors.push(...live.errors);
  }

  const elapsedAfterLive = Date.now() - started;
  const remainingBudget = Math.max(0, timeBudgetMs - elapsedAfterLive);

  let batches: PredictionBatch[];
  try {
    batches = await loadAllBatches();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ...traceSummary,
      errors: [...traceSummary.errors, ...liveErrors, msg],
      unavailable: true,
      filled: traceSummary.matchesSynced,
      enriched: 0,
      failed: 0,
      remaining: [],
      liveMerged,
      liveUpdatedBatches,
      archivedBatchIds: [],
    };
  }

  const pass = await runApiFillPass(batches, {
    batchId: opts?.batchId,
    maxMatches,
    timeBudgetMs: remainingBudget,
    startedAt: started,
  });

  let enrichUpdatedBatches = 0;
  const archivedBatchIds: string[] = [];
  for (const [batchId, state] of pass.updatedBatches) {
    try {
      const updatedBatch = scoreBatchWithUpdatedMatches(
        state.batch,
        state.batch.matches.map((m) => state.byId.get(m.id) ?? m)
      );
      const { archived } = await persistUpdatedBatch(updatedBatch);
      enrichUpdatedBatches += 1;
      if (archived) archivedBatchIds.push(batchId);
    } catch (e) {
      pass.errors.push(
        `Failed to save ${state.batch.batchName}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }

  const totalUpdated =
    traceSummary.updatedBatches + liveUpdatedBatches + enrichUpdatedBatches;

  return {
    updatedBatches: totalUpdated,
    matchesSynced: traceSummary.matchesSynced + pass.filled,
    matchesNotFound: traceSummary.matchesNotFound,
    errors: [...traceSummary.errors, ...liveErrors, ...pass.errors],
    conflicts: traceSummary.conflicts,
    unavailable: traceSummary.unavailable || pass.unavailable,
    trace: traceSummary.trace,
    filled: traceSummary.matchesSynced + pass.filled,
    enriched: pass.enriched,
    failed: pass.failed,
    remaining: pass.remaining,
    liveMerged,
    liveUpdatedBatches,
    archivedBatchIds: [
      ...new Set([
        ...traceSummary.archivedBatchIds,
        ...liveArchivedBatchIds,
        ...archivedBatchIds,
      ]),
    ],
  };
}

export function batchNeedsAnyApiSync(batch: PredictionBatch): boolean {
  return (
    batchNeedsResults(batch) ||
    batch.matches.some(
      (m) => matchNeedsNamePairTrace(m) || matchNeedsApiDetailFill(m)
    )
  );
}
