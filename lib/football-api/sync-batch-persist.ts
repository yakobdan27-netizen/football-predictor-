/**
 * Shared Prediction Log batch persist after API fill / trace.
 */
import { loadAllBatches, saveBatch } from "@/lib/prediction-log/club-store";
import { syncBatchToClubHistories } from "@/lib/prediction-log/club-history-writer";
import { maybeRetrainOnBatchResult } from "@/lib/prediction-log/retrain-ml";
import { maybeBayesianCalibrateOnBatch } from "@/lib/prediction-log/bayesian-calibration";
import { computeLeagueBaselines } from "@/lib/prediction-log/league-baselines";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { recomputeAndPersistLearnerStats } from "@/lib/prediction-log/learner-stats-store";
import { recomputeAndPersistLeaguePriors } from "@/lib/prediction-log/league-priors-store";
import { recomputePlSeasonCards } from "@/lib/prediction-log/pl-season-store";
import { recomputeLlSeasonCards } from "@/lib/prediction-log/ll-season-store";
import { recomputeBlSeasonCards } from "@/lib/prediction-log/bl-season-store";
import { recomputeSaSeasonCards } from "@/lib/prediction-log/sa-season-store";
import { recomputeL1SeasonCards } from "@/lib/prediction-log/l1-season-store";
import {
  scoreBatch,
  marketsEnteredCount,
} from "@/lib/prediction-log/scoring";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { maybeArchiveCompletedBatch } from "@/lib/prediction-log/batch-lifecycle";

export function batchDateIsPastOrToday(date: string): boolean {
  const digits = date.replace(/[^0-9]/g, "");
  let ymd = "";
  if (/^\d{4}-\d{2}-\d{2}/.test(date.trim())) {
    ymd = date.trim().slice(0, 10).replace(/-/g, "");
  } else if (digits.length >= 8) {
    ymd = digits.slice(0, 8);
  } else {
    return true;
  }
  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
  return ymd <= todayKey;
}

export function applySettledStatusIfComplete(
  batch: PredictionBatch
): PredictionBatch {
  const entered = marketsEnteredCount(batch);
  if (entered.total > 0 && entered.scored === entered.total) {
    return {
      ...batch,
      recommendationStatus:
        batch.batchKind === "recommended" ? "SETTLED" : batch.recommendationStatus,
      settledAt:
        batch.batchKind === "recommended"
          ? new Date().toISOString()
          : batch.settledAt,
    };
  }
  return batch;
}

export function scoreBatchWithUpdatedMatches(
  batch: PredictionBatch,
  updatedMatches: LogMatch[]
): PredictionBatch {
  return applySettledStatusIfComplete(
    scoreBatch({ ...batch, matches: updatedMatches })
  );
}

export async function persistUpdatedBatch(
  updatedBatch: PredictionBatch
): Promise<{ batch: PredictionBatch; archived: boolean }> {
  const allBatches = await loadAllBatches();
  const leagueBaselines = computeLeagueBaselines(allBatches);
  const teamsQuality = await loadTeamsQualityStore().catch(() => null);
  const synced = await syncBatchToClubHistories(updatedBatch, {
    leagueBaselines,
    teamsQuality,
  });
  await saveBatch(synced);
  await maybeRetrainOnBatchResult(synced).catch(() => null);
  await maybeBayesianCalibrateOnBatch(synced).catch(() => null);
  await recomputeGlobalStoresAfterBatchUpdates();
  const archived = await maybeArchiveCompletedBatch(synced);
  return { batch: synced, archived };
}

export async function recomputeGlobalStoresAfterBatchUpdates(): Promise<void> {
  await recomputeAndPersistLearnerStats().catch(() => null);
  await recomputeAndPersistLeaguePriors().catch(() => null);
  await recomputePlSeasonCards().catch(() => null);
  await recomputeLlSeasonCards().catch(() => null);
  await recomputeBlSeasonCards().catch(() => null);
  await recomputeSaSeasonCards().catch(() => null);
  await recomputeL1SeasonCards().catch(() => null);
}
