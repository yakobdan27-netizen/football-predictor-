import { NextResponse } from "next/server";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { batchNeedsResults } from "@/lib/prediction-log/scoring";
import { matchNeedsNamePairTrace } from "@/lib/prediction-log/result-trace";
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
 * Every 30 minutes (06–22 UTC): ordered name-pair result trace for pending
 * Prediction Log batches (web + telegram). Same path as POST /api/sync-results.
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
    const pending = all.filter(
      (b) =>
        batchNeedsResults(b) || b.matches.some((m) => matchNeedsNamePairTrace(m))
    );

    // Single pass over all pending — syncPredictionLogResults already loops batches.
    const summary = await syncPredictionLogResults();

    if (pending.length > 0 || summary.updatedBatches > 0) {
      await recomputeAndPersistLearnerStats().catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      pendingBatches: pending.length,
      pendingTelegram: pending.filter((b) => b.source === "telegram").length,
      updatedBatches: summary.updatedBatches,
      matchesSynced: summary.matchesSynced,
      matchesNotFound: summary.matchesNotFound,
      trace: summary.trace,
      errors: summary.errors.slice(0, 10),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Result fill cron failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
