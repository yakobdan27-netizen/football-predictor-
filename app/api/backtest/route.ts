import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { dbMatchToRow } from "@/lib/csv";
import { backtestCompare } from "@/lib/predictor/backtest-enhance";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      testFraction = 0.2,
      decayXi = 0.002,
      minTrain = 50,
      blendOdds = false,
      blendAlpha = 0.5,
      calibrate = false,
    } = body;

    const db = await getDb();
    const rows = await db.select().from(schema.matches);
    if (rows.length < minTrain + 5) {
      return NextResponse.json(
        {
          error: `Need at least ${minTrain + 5} matches for backtest. Have ${rows.length}.`,
        },
        { status: 400 }
      );
    }

    const matchRows = rows.map(dbMatchToRow);
    const result = backtestCompare(matchRows, testFraction, minTrain, decayXi, {
      blendOdds: Boolean(blendOdds),
      blendAlpha: Number(blendAlpha),
      calibrate: Boolean(calibrate),
    });

    return NextResponse.json({
      metrics: result.metrics,
      metricsEnhanced: result.metricsEnhanced ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Backtest failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
