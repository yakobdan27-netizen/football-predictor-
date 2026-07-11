import { NextResponse } from "next/server";
import { syncBatchFromLivescore } from "@/lib/livescore/sync-batch";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let body: { batchId?: string; matchIds?: string[]; maxScrapes?: number } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }

    if (!body.batchId?.trim()) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    const summary = await syncBatchFromLivescore({
      batchId: body.batchId.trim(),
      matchIds: body.matchIds,
      maxScrapes: body.maxScrapes,
    });

    return NextResponse.json({
      ok: true,
      filled: summary.filled,
      failed: summary.failed,
      cached: summary.cached,
      remaining: summary.remaining,
      errors: summary.errors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Livescore scrape failed";
    console.error("[scrape-livescore]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
