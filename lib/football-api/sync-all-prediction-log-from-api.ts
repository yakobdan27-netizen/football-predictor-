/**
 * Unified Prediction Log API fill: trace → live DB merge → API enrich pass.
 */
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { batchNeedsAnyApiSync } from "@/lib/prediction-log/batch-sync-needs";
export { batchNeedsAnyApiSync } from "@/lib/prediction-log/batch-sync-needs";
import type { TraceStatusCounts } from "@/lib/prediction-log/result-trace";
import { syncPredictionLogFromLiveFixtures } from "@/lib/prediction-log/sync-from-live-fixtures";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import {
  runApiFillPass,
  DEFAULT_TIME_BUDGET_MS,
  collectApiFillWorkItems,
  resolveMaxMatchesForWork,
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
  rounds?: number;
};

const LOOP_MAX_ROUNDS = 15;
const LOOP_TIME_BUDGET_MS = 55_000;

async function persistApiFillPass(
  pass: Awaited<ReturnType<typeof runApiFillPass>>
): Promise<{ enrichUpdatedBatches: number; archivedBatchIds: string[]; errors: string[] }> {
  let enrichUpdatedBatches = 0;
  const archivedBatchIds: string[] = [];
  const errors: string[] = [];
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
      errors.push(
        `Failed to save ${state.batch.batchName}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }
  return { enrichUpdatedBatches, archivedBatchIds, errors };
}

export async function syncAllPredictionLogFromApi(opts?: {
  batchId?: string;
  maxMatches?: number;
  timeBudgetMs?: number;
  skipTrace?: boolean;
  skipLive?: boolean;
}): Promise<SyncAllPredictionLogSummary> {
  const started = Date.now();
  const timeBudgetMs = opts?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;

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
    maxMatches:
      opts?.maxMatches ??
      resolveMaxMatchesForWork(collectApiFillWorkItems(batches, { batchId: opts?.batchId })),
    timeBudgetMs: remainingBudget,
    startedAt: started,
  });

  const persisted = await persistApiFillPass(pass);

  const totalUpdated =
    traceSummary.updatedBatches + liveUpdatedBatches + persisted.enrichUpdatedBatches;

  return {
    updatedBatches: totalUpdated,
    matchesSynced: traceSummary.matchesSynced + pass.filled,
    matchesNotFound: traceSummary.matchesNotFound,
    errors: [...traceSummary.errors, ...liveErrors, ...pass.errors, ...persisted.errors],
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
        ...persisted.archivedBatchIds,
      ]),
    ],
  };
}

/** Multi-round sync for crons — repeats until pending work is cleared or budget exhausted. */
export async function syncAllPredictionLogFromApiLoop(opts?: {
  batchId?: string;
  maxMatches?: number;
  timeBudgetMs?: number;
  maxRounds?: number;
  skipTrace?: boolean;
  skipLive?: boolean;
}): Promise<SyncAllPredictionLogSummary> {
  const started = Date.now();
  const timeBudgetMs = opts?.timeBudgetMs ?? LOOP_TIME_BUDGET_MS;
  const maxRounds = opts?.maxRounds ?? LOOP_MAX_ROUNDS;

  let aggregate: SyncAllPredictionLogSummary = {
    updatedBatches: 0,
    matchesSynced: 0,
    matchesNotFound: 0,
    errors: [],
    conflicts: [],
    trace: {
      pending: 0,
      foundNotFinal: 0,
      filled: 0,
      ambiguous: 0,
      needsReview: 0,
      retry: 0,
    },
    filled: 0,
    enriched: 0,
    failed: 0,
    remaining: [],
    liveMerged: 0,
    liveUpdatedBatches: 0,
    archivedBatchIds: [],
    rounds: 0,
  };

  for (let round = 1; round <= maxRounds; round++) {
    if (Date.now() - started >= timeBudgetMs) break;

    const roundSummary = await syncAllPredictionLogFromApi({
      ...opts,
      timeBudgetMs: Math.max(5_000, timeBudgetMs - (Date.now() - started)),
      skipTrace: round > 1 ? true : opts?.skipTrace,
      skipLive: round > 1 ? true : opts?.skipLive,
    });

    aggregate = {
      ...roundSummary,
      updatedBatches: aggregate.updatedBatches + roundSummary.updatedBatches,
      matchesSynced: aggregate.matchesSynced + roundSummary.matchesSynced,
      matchesNotFound: aggregate.matchesNotFound + roundSummary.matchesNotFound,
      errors: [...aggregate.errors, ...roundSummary.errors],
      conflicts: [...aggregate.conflicts, ...roundSummary.conflicts],
      filled: aggregate.filled + roundSummary.filled,
      enriched: aggregate.enriched + roundSummary.enriched,
      failed: aggregate.failed + roundSummary.failed,
      remaining: roundSummary.remaining,
      liveMerged: aggregate.liveMerged + roundSummary.liveMerged,
      liveUpdatedBatches:
        aggregate.liveUpdatedBatches + roundSummary.liveUpdatedBatches,
      archivedBatchIds: [
        ...new Set([
          ...aggregate.archivedBatchIds,
          ...roundSummary.archivedBatchIds,
        ]),
      ],
      trace: roundSummary.trace,
      unavailable: roundSummary.unavailable,
      rounds: round,
    };

    if (roundSummary.unavailable) break;
    if (roundSummary.remaining.length === 0) break;
  }

  return aggregate;
}
