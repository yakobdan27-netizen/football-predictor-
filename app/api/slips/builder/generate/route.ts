import { NextResponse } from "next/server";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { loadBayesianCalibrationLog } from "@/lib/prediction-log/bayesian-calibration";
import { generateSlipBatch } from "@/lib/slip-builder/generate";
import { nextBatchNumber, saveSlipBatchResult } from "@/lib/slip-builder/store";
import type { SlipPreferences } from "@/lib/slip-builder/types";
import { validateFamilySelection } from "@/lib/slip-builder/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      preferences?: Partial<SlipPreferences>;
      excludeFixtureIds?: string[];
      persist?: boolean;
    };

    if (body.preferences?.families) {
      const v = validateFamilySelection(body.preferences.families);
      if (!v.ok) {
        return NextResponse.json(
          {
            error: `Conflict group ${v.groupId}: ${v.conflict[0]} and ${v.conflict[1]} cannot both be selected.`,
          },
          { status: 400 }
        );
      }
    }

    const allBatches = await loadAllBatches();
    const bayesianLog = await loadBayesianCalibrationLog().catch(() => null);
    const batchNumber = await nextBatchNumber().catch(() => 1);

    const result = await generateSlipBatch({
      allBatches,
      preferences: body.preferences,
      excludeFixtureIds: body.excludeFixtureIds,
      bayesianLog,
      batchNumber,
    });

    if (body.persist === false) {
      return NextResponse.json({ batch: result });
    }

    try {
      const saved = await saveSlipBatchResult(result);
      return NextResponse.json({ batch: saved });
    } catch {
      return NextResponse.json({ batch: result, persisted: false });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to generate slips";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
