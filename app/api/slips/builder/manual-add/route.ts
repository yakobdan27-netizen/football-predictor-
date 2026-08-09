import { NextResponse } from "next/server";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { loadBayesianCalibrationLog } from "@/lib/prediction-log/bayesian-calibration";
import { buildMutationContext } from "@/lib/slip-builder/mutate-context";
import { buildCandidateLeg } from "@/lib/slip-builder/eligibility";
import { fitSlipCalibrator } from "@/lib/slip-builder/slip-calibration";
import { loadBatchFixturePool } from "@/lib/slip-builder/batch-pool";
import { manualAddLeg } from "@/lib/slip-builder/optimizer";
import { loadSlipBatch, updateSlipBatchResult } from "@/lib/slip-builder/store";
import type {
  CandidateLeg,
  MarketFamilyId,
  SlipBatchResult,
} from "@/lib/slip-builder/types";

export const dynamic = "force-dynamic";

/**
 * Manual add is never blocked — even if the leg fails eligibility gates.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      batchId: number | string;
      slipIndex: number;
      batch?: SlipBatchResult;
      leg?: CandidateLeg;
      /** Resolve from pool if leg not fully provided. */
      fixtureId?: string;
      family?: MarketFamilyId;
      selectionKey?: string;
      selectionLabel?: string;
      line?: number | null;
      comboId?: string | null;
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
    const { rhoLookup } = await buildMutationContext({
      allBatches,
      prefs: result.preferences,
      bayesianLog,
    });

    let leg = body.leg ?? null;
    if (!leg && body.fixtureId && body.family && body.selectionKey) {
      const fixtures = loadBatchFixturePool(allBatches, result.preferences);
      const fixture = fixtures.find((f) => f.fixtureId === body.fixtureId);
      const calibrator = fitSlipCalibrator(allBatches, bayesianLog);
      if (fixture) {
        leg = buildCandidateLeg({
          fixture,
          family: body.family,
          selectionKey: body.selectionKey,
          selectionLabel: body.selectionLabel ?? body.selectionKey,
          line: body.line,
          comboId: body.comboId,
          calibrator,
        });
      }
    }

    if (!leg) {
      return NextResponse.json(
        { error: "Could not resolve leg to add" },
        { status: 400 }
      );
    }

    // Never block — always add
    result = manualAddLeg({
      result,
      slipIndex: body.slipIndex,
      leg,
      rhoLookup,
    });

    const id = Number(result.batchId);
    if (Number.isFinite(id)) {
      try {
        await updateSlipBatchResult(id, result);
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json({ batch: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to add leg";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
