import { NextResponse } from "next/server";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { loadBayesianCalibrationLog } from "@/lib/prediction-log/bayesian-calibration";
import { buildMutationContext } from "@/lib/slip-builder/mutate-context";
import { swapLeg } from "@/lib/slip-builder/optimizer";
import { loadSlipBatch, updateSlipBatchResult } from "@/lib/slip-builder/store";
import type { SlipBatchResult } from "@/lib/slip-builder/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      batchId: number | string;
      slipIndex: number;
      legOrder: number;
      batch?: SlipBatchResult;
    };

    let result: SlipBatchResult | null =
      body.batch ??
      (Number.isFinite(Number(body.batchId))
        ? await loadSlipBatch(Number(body.batchId))
        : null);
    if (!result) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const allBatches = await loadAllBatches();
    const bayesianLog = await loadBayesianCalibrationLog().catch(() => null);
    const { byFamily, rhoLookup } = await buildMutationContext({
      allBatches,
      prefs: result.preferences,
      bayesianLog,
    });

    result = swapLeg({
      result,
      slipIndex: body.slipIndex,
      legOrder: body.legOrder,
      byFamily,
      rhoLookup,
    });

    const id = Number(result.batchId);
    if (Number.isFinite(id)) {
      try {
        await updateSlipBatchResult(id, result);
      } catch {
        /* ignore persist errors */
      }
    }

    return NextResponse.json({ batch: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to swap leg";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
