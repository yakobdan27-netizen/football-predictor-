import { NextResponse } from "next/server";
import { runLivePoll } from "@/lib/live/sync-live";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Public in-play poll for the Live page (browser-safe).
 * Does not require CRON_SECRET or admin unlock.
 */
async function run() {
  const summary = await runLivePoll();
  return NextResponse.json(summary, {
    status: summary.ok || summary.skippedRun ? 200 : 503,
  });
}

export async function GET() {
  return run();
}

export async function POST() {
  return run();
}
