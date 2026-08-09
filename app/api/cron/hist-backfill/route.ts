import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/live/cron-auth";
import { runDailyHistDrain } from "@/lib/hist/daily-drain";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Daily (multi-slot) hist inventory drain.
 * Always gap-priority / deep-first. No-ops once inventoryPass = 66/66.
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
      mode: "gapPriority",
      scheduleNote:
        "Runs several times daily via vercel.json until inventoryPass=66",
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
