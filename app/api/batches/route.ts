import { NextResponse } from "next/server";
import { deleteAllBatches, loadAllBatches, saveBatch } from "@/lib/prediction-log/club-store";
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
import { batchHasScoredResults } from "@/lib/prediction-log/scoring";
import { findCrossBatchDuplicates } from "@/lib/prediction-log/cross-batch-duplicate-check";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export async function GET() {
  try {
    const batches = await loadAllBatches();
    return NextResponse.json({ batches });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load batches";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await deleteAllBatches();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to delete all batches";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const batch = (await request.json()) as PredictionBatch;
    if (!batch?.id || !batch.batchName) {
      return NextResponse.json({ error: "Invalid batch" }, { status: 400 });
    }
    const allBatches = await loadAllBatches();
    const isNewBatch = !allBatches.some((b) => b.id === batch.id);
    if (isNewBatch) {
      const duplicates = findCrossBatchDuplicates({
        incomingBatch: batch,
        allBatches,
      });
      if (duplicates.length > 0) {
        return NextResponse.json(
          {
            error:
              "Duplicate prediction detected: this match + market + prediction already exists in another batch on the same date.",
            duplicates,
          },
          { status: 409 }
        );
      }
    }
    const leagueBaselines = computeLeagueBaselines(allBatches);
    const teamsQuality = await loadTeamsQualityStore().catch(() => null);
    const synced = await syncBatchToClubHistories(batch, { leagueBaselines, teamsQuality });
    await saveBatch(synced);
    await maybeRetrainOnBatchResult(synced).catch(() => null);
    await maybeBayesianCalibrateOnBatch(synced).catch(() => null);
    if (batchHasScoredResults(synced)) {
      await recomputeAndPersistLearnerStats().catch(() => null);
      await recomputeAndPersistLeaguePriors().catch(() => null);
      await recomputePlSeasonCards().catch(() => null);
      await recomputeLlSeasonCards().catch(() => null);
      await recomputeBlSeasonCards().catch(() => null);
    }
    return NextResponse.json({ ok: true, batch: synced });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save batch";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
