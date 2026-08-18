import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/live/cron-auth";
import { runDailyHistDrain } from "@/lib/hist/daily-drain";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Daily (multi-slot) hist inventory + HT/corners enrichment drain.
 * Gap-priority / deep-first. After inventoryPass=66/66, enrichment phase continues.
 */
async function run(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Keep to 1 chunk per invoke — fits 60s; vercel.json schedules several slots/day.
  const result = await runDailyHistDrain({ maxChunks: 1 });
  const status =
    result.stoppedReason === "quota"
      ? 200
      : result.ok
        ? 200
        : 503;

  return NextResponse.json(
    {
      ...result,
      mode: result.phase === "enrichment" ? "enrichment" : "gapPriority",
      scheduleNote:
        result.phase === "enrichment"
          ? "Inventory gate passed — draining HT/corners enrichment gaps"
          : "Runs several times daily via vercel.json until inventoryPass=66",
    },
    { status }
  );
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
