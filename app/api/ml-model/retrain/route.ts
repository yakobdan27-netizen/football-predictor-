import { NextResponse } from "next/server";
import { loadAllBatches, loadAllClubRecords } from "@/lib/prediction-log/club-store";
import { retrainStatModels } from "@/lib/prediction-log/retrain-ml";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { recomputeAnalysis } from "@/lib/prediction-log/analysis";

export async function POST() {
  try {
    const batches = await loadAllBatches();
    const clubList = await loadAllClubRecords();
    const clubRecords = Object.fromEntries(clubList.map((c) => [c.clubId, c]));
    const teamsQuality = await loadTeamsQualityStore();
    const analysis = recomputeAnalysis(batches);
    const result = await retrainStatModels(batches, clubRecords, analysis, teamsQuality);

    return NextResponse.json({
      ok: true,
      trainingRows: result.trainingRows,
      algorithm: result.classifier.algorithm,
      sampleCount: result.classifier.sampleCount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Retrain failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
