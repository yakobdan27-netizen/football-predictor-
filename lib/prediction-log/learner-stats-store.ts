import { recomputeLearnerStats, emptyLearnerStats } from "./ai-learner";
import { recomputeClubProfiles } from "./club-profiles";
import { loadAllBatches } from "./club-store";
import { getJson, setJson } from "./kv";
import { KV_KEYS } from "./kv-keys";
import type { LearnerStatsStore, PredictionBatch } from "./types";

export async function loadLearnerStatsStore(): Promise<LearnerStatsStore> {
  const stored = await getJson<LearnerStatsStore>(KV_KEYS.learnerStats);
  if (!stored?.oddsRanges) return emptyLearnerStats();
  return stored;
}

export async function saveLearnerStatsStore(stats: LearnerStatsStore): Promise<void> {
  await setJson(KV_KEYS.learnerStats, stats);
}

/**
 * Recompute global learner stats from all batches and persist to KV.
 * Club profiles are derived from the same batch set (server has no browser localStorage).
 */
export async function recomputeAndPersistLearnerStats(
  allBatches?: PredictionBatch[]
): Promise<LearnerStatsStore> {
  const batches = allBatches ?? (await loadAllBatches());
  const clubProfiles = recomputeClubProfiles(batches);
  const stats = recomputeLearnerStats(batches, null, clubProfiles);
  await saveLearnerStatsStore(stats);
  return stats;
}
