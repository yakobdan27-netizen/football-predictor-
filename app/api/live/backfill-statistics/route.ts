import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/live/cron-auth";
import { runBackfillApiStatistics } from "@/lib/live/hydrate-api-statistics";

export const maxDuration = 60;
export const runtime = "nodejs";

async function run(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const daysRaw = url.searchParams.get("days");
  const limit = limitRaw != null ? Number(limitRaw) : 20;
  const days = daysRaw != null ? Number(daysRaw) : 30;

  const summary = await runBackfillApiStatistics({
    limit: Number.isFinite(limit) ? Math.min(Math.max(1, limit), 50) : 20,
    days: Number.isFinite(days) ? Math.min(Math.max(1, days), 90) : 30,
  });

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
