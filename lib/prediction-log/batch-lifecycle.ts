/**
 * Completed-batch lifecycle: detect all FT results filled, persist reference
 * stores, then remove the batch from active KV (hidden from all UI lists).
 */
import {
  deleteBatch,
  loadAllBatches,
  loadBatch,
} from "./club-store";
import { syncBatchToClubHistories } from "./club-history-writer";
import { computeLeagueBaselines } from "./league-baselines";
import { loadTeamsQualityStore } from "./teams-quality-store";
import {
  batchDateIsPastOrToday,
  recomputeGlobalStoresAfterBatchUpdates,
} from "@/lib/football-api/sync-batch-persist";
import { batchAllMatchesRichSettlement } from "./match-settlement";
import type { LogMatch, PredictionBatch } from "./types";

export function matchHasFinalResult(match: LogMatch): boolean {
  const hg = match.teamStats?.home?.goals;
  const ag = match.teamStats?.away?.goals;
  if (typeof hg !== "number" || typeof ag !== "number") return false;
  if (match.resultFilled === true || match.resultTraceState === "FILLED") {
    return true;
  }
  return false;
}

export function batchAllMatchesFinished(batch: PredictionBatch): boolean {
  if (batch.matches.length === 0) return false;
  if (!batchDateIsPastOrToday(batch.date)) return false;
  return batchAllMatchesRichSettlement(batch);
}

/**
 * Persist reference data then delete batch from active index.
 * Returns false when batch is missing, incomplete, or persist fails.
 */
export async function archiveCompletedBatch(batchId: string): Promise<boolean> {
  const batch = await loadBatch(batchId);
  if (!batch || !batchAllMatchesFinished(batch)) return false;

  try {
    const allBatches = await loadAllBatches();
    const leagueBaselines = computeLeagueBaselines(allBatches);
    const teamsQuality = await loadTeamsQualityStore().catch(() => null);
    await syncBatchToClubHistories(batch, { leagueBaselines, teamsQuality });
    await recomputeGlobalStoresAfterBatchUpdates();
    await deleteBatch(batchId);
    return true;
  } catch {
    return false;
  }
}

/** Archive when every match has rich settlement; no-op otherwise. */
export async function maybeArchiveCompletedBatch(
  batch: PredictionBatch
): Promise<boolean> {
  if (!batchAllMatchesFinished(batch)) return false;
  return archiveCompletedBatch(batch.id);
}
