import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/live/cron-auth";
import { runLivePoll } from "@/lib/live/sync-live";

export const maxDuration = 60;
export const runtime = "nodejs";

async function run(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runLivePoll();
  return NextResponse.json(summary, {
    status: summary.ok || summary.skippedRun ? 200 : 503,
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
