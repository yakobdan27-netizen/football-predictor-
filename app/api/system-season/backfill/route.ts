import { NextResponse } from "next/server";
import { runSystemSeasonBackfill } from "@/lib/system-season/ingest-from-api";

export const maxDuration = 60;
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const season = parseInt(url.searchParams.get("season") ?? "2026", 10);
  const leagueName = url.searchParams.get("league") ?? undefined;
  const maxFixtures = parseInt(url.searchParams.get("max") ?? "40", 10);

  const summary = await runSystemSeasonBackfill({
    season,
    leagueName,
    maxFixtures,
  });

  return NextResponse.json(summary, { status: summary.ok ? 200 : 503 });
}

export async function GET(request: Request) {
  return POST(request);
}
