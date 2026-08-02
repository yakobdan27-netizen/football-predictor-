import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db/init";
import { readHistMeta } from "@/lib/hist/preflight";
import { ensureHistJobs, histJobsSummary } from "@/lib/hist/store";
import { histSeasonYears, HIST_BIG5_LEAGUES } from "@/lib/hist/seasons";

export const maxDuration = 30;
export const runtime = "nodejs";

/**
 * GET /api/hist/backfill/status
 * Jobs summary + fixture counts (read-only).
 */
export async function GET() {
  try {
    await ensureSchema();
    await ensureHistJobs();
    const summary = await histJobsSummary();
    const meta = await readHistMeta();
    return NextResponse.json({
      ok: true,
      seasons: histSeasonYears(),
      leagues: HIST_BIG5_LEAGUES,
      byStatus: summary.byStatus,
      fixtures: summary.fixtures,
      goals: summary.goals,
      stats: summary.stats,
      jobs: summary.jobs.map((j) => ({
        leagueId: j.leagueId,
        season: j.season,
        leagueName: j.leagueName,
        status: j.status,
        cursorFixtureId: j.cursorFixtureId,
        fixturesTotal: j.fixturesTotal,
        fixturesImported: j.fixturesImported,
        goalsImported: j.goalsImported,
        statsImported: j.statsImported,
        skipReason: j.skipReason,
        updatedAt: j.updatedAt,
      })),
      meta: meta
        ? {
            plan: meta.plan,
            limitDay: meta.limitDay,
            remaining: meta.remaining,
            lastRunAt: meta.lastRunAt,
            lastSummary: meta.lastSummary,
            beta2hJson: meta.beta2hJson,
          }
        : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
