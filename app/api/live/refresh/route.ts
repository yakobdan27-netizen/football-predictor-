import { NextResponse } from "next/server";
import { runLivePoll } from "@/lib/live/sync-live";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * On-demand live poll for the /live UI (Hobby plans can't run minutely crons).
 * Writes only to live_* tables. Skips API work when nothing is in the live window.
 */
export async function POST() {
  try {
    const summary = await runLivePoll();
    return NextResponse.json(summary, {
      status: summary.ok || summary.skipped ? 200 : 503,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Live refresh failed";
    return NextResponse.json(
      { ok: false, error: msg, upserted: 0, settledEmitted: 0 },
      { status: 503 }
    );
  }
}

export async function GET() {
  return POST();
}
