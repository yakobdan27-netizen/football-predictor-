import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/live/cron-auth";
import {
  cronInterleaveEnrichmentFromEnv,
  cronMaxChunksFromEnv,
  HIST_CRON_DEADLINE_MS_DEFAULT,
  runDailyHistDrain,
} from "@/lib/hist/daily-drain";

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

  const maxChunks = cronMaxChunksFromEnv();
  const interleave = cronInterleaveEnrichmentFromEnv();
  const result = await runDailyHistDrain({
    maxChunks,
    deadlineMs: HIST_CRON_DEADLINE_MS_DEFAULT,
    interleaveEnrichment: interleave,
  });
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
      maxChunks,
      interleaveEnrichment: interleave,
      scheduleNote:
        result.phase === "enrichment"
          ? "Inventory gate passed — draining HT/corners enrichment gaps"
          : interleave
            ? `Multi-chunk drain (≤${maxChunks} chunks / ${HIST_CRON_DEADLINE_MS_DEFAULT / 1000}s) · inventory-first with interleaved HT/corners`
            : `Multi-chunk drain (≤${maxChunks} chunks / ${HIST_CRON_DEADLINE_MS_DEFAULT / 1000}s) · inventory until 66/66`,
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
