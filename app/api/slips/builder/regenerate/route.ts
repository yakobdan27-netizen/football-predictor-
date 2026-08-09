import { NextResponse } from "next/server";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { loadBayesianCalibrationLog } from "@/lib/prediction-log/bayesian-calibration";
import { generateSlipBatch } from "@/lib/slip-builder/generate";
import {
  loadSlipBatch,
  nextBatchNumber,
  saveSlipBatchResult,
} from "@/lib/slip-builder/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      fromBatchId: number | string;
    };
    const fromId = Number(body.fromBatchId);
    if (!Number.isFinite(fromId)) {
      return NextResponse.json({ error: "fromBatchId required" }, { status: 400 });
    }

    const prior = await loadSlipBatch(fromId);
    if (!prior) {
      return NextResponse.json({ error: "Prior batch not found" }, { status: 404 });
    }

    const usedFixtures = prior.slips.flatMap((s) =>
      s.legs.map((l) => l.fixtureId)
    );
    const exclude = [
      ...new Set([...(prior.fixtureExclusionIds ?? []), ...usedFixtures]),
    ];

    const allBatches = await loadAllBatches();
    const bayesianLog = await loadBayesianCalibrationLog().catch(() => null);
    const batchNumber = await nextBatchNumber().catch(() => prior.batchNumber + 1);

    const result = await generateSlipBatch({
      allBatches,
      preferences: prior.preferences,
      excludeFixtureIds: exclude,
      bayesianLog,
      batchNumber,
    });

    try {
      const saved = await saveSlipBatchResult(result, {
        regeneratedFromId: fromId,
      });
      return NextResponse.json({ batch: saved });
    } catch {
      return NextResponse.json({ batch: result, persisted: false });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to regenerate";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
