import { NextResponse } from "next/server";
import { syncPredictionLogResults } from "@/lib/football-api/sync-prediction-log";

export async function POST(request: Request) {
  try {
    let batchId: string | undefined;
    try {
      const body = (await request.json()) as { batchId?: string };
      batchId = body?.batchId;
    } catch {
      batchId = undefined;
    }

    const summary = await syncPredictionLogResults(batchId);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to sync results";
    const status = msg.includes("API_FOOTBALL_KEY") ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
