import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/live/cron-auth";
import { runHistBackfillChunk } from "@/lib/hist/backfill";

export const maxDuration = 60;
export const runtime = "nodejs";

async function run(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runHistBackfillChunk();
  return NextResponse.json(summary, {
    status: summary.ok ? 200 : 503,
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
