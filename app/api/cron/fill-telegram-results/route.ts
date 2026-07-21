import { NextResponse } from "next/server";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { batchNeedsResults } from "@/lib/prediction-log/scoring";
import { recomputeAndPersistLearnerStats } from "@/lib/prediction-log/learner-stats-store";
import { syncPredictionLogResults } from "@/lib/football-api/sync-prediction-log";

export const maxDuration = 60;
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Hourly catch-up: auto-fill incomplete batches (web + telegram) via API-Football.
 * Prefers matches with apiFixtureId; legacy date+pair matching remains in sync.
 */
export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

async function run(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const all = await loadAllBatches();
    const pending = all.filter((b) => batchNeedsResults(b));
    let updatedBatches = 0;
    let matchesSynced = 0;
    const errors: string[] = [];

    for (const batch of pending) {
      const summary = await syncPredictionLogResults(batch.id);
      updatedBatches += summary.updatedBatches;
      matchesSynced += summary.matchesSynced;
      if (summary.errors.length) errors.push(...summary.errors.slice(0, 3));
    }

    if (pending.length > 0 || updatedBatches > 0) {
      await recomputeAndPersistLearnerStats().catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      pendingBatches: pending.length,
      pendingTelegram: pending.filter((b) => b.source === "telegram").length,
      updatedBatches,
      matchesSynced,
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Result fill cron failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
