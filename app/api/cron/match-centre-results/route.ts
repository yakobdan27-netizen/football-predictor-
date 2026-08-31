import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/live/cron-auth";
import { runMatchCentreResultSync } from "@/lib/match-centre/result-sync";
import { recomputeAndPersistLearnerStats } from "@/lib/prediction-log/learner-stats-store";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Match Centre automatic result fill — FT scores, corners, goal events, bet settle.
 * Isolated from Prediction Log sync-results / fill-telegram-results.
 */
async function run(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runMatchCentreResultSync();
  const learnerStats = await recomputeAndPersistLearnerStats().catch(() => null);

  return NextResponse.json(
    {
      ...summary,
      learnerStatsUpdated: learnerStats != null,
    },
    { status: summary.ok ? 200 : 503 }
  );
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
