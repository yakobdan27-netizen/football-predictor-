import { NextResponse } from "next/server";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { batchNeedsResults } from "@/lib/prediction-log/scoring";
import { matchNeedsNamePairTrace } from "@/lib/prediction-log/result-trace";
import { matchNeedsApiDetailFill } from "@/lib/football-api/map-fixture-to-match";
import { syncAllPredictionLogFromApiLoop } from "@/lib/football-api/sync-all-prediction-log-from-api";
import { recomputeAndPersistLearnerStats } from "@/lib/prediction-log/learner-stats-store";

export const maxDuration = 60;
export const runtime = "nodejs";

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Fri–Sun every 30 min (06–23 UTC) + daily catch-up: unified API trace + live merge
 * + enrich for all pending Prediction Log batches (web + telegram).
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
        batchNeedsResults(b) ||
        b.matches.some(
          (m) => matchNeedsNamePairTrace(m) || matchNeedsApiDetailFill(m)
        )
    );

    const summary = await syncAllPredictionLogFromApiLoop();
    const learnerStats = await recomputeAndPersistLearnerStats().catch(() => null);

    return NextResponse.json({
      ok: !summary.unavailable,
      pendingBatches: pending.length,
      pendingTelegram: pending.filter((b) => b.source === "telegram").length,
      updatedBatches: summary.updatedBatches,
      matchesSynced: summary.matchesSynced,
      matchesNotFound: summary.matchesNotFound,
      filled: summary.filled,
      enriched: summary.enriched,
      failed: summary.failed,
      remaining: summary.remaining.length,
      rounds: summary.rounds ?? 1,
      liveMerged: summary.liveMerged,
      liveUpdatedBatches: summary.liveUpdatedBatches,
      trace: summary.trace,
      learnerStatsUpdated: learnerStats != null,
      errors: summary.errors.slice(0, 10),
      unavailable: summary.unavailable,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Result fill cron failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
