import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { sumFilterReasons } from "@/lib/football-api/fixture-eligibility";
import {
  buildWeekendPool,
  normalizeWeekendBatch,
} from "@/lib/match-centre/build-weekend-pool";
import { curateWeekendPortfolio } from "@/lib/match-centre/weekend-portfolio";
import { buildUpcomingPredictionBatch } from "@/lib/prediction-log/batch-fixture-picker";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import {
  persistWeekendAnalysisLearnerBatches,
  type WeekendLearnerSyncResult,
} from "@/lib/prediction-log/weekend-analysis-learner";
import { recomputeAndPersistLearnerStats } from "@/lib/prediction-log/learner-stats-store";
import { filterWeekendFixtures } from "@/lib/match-centre/weekend-opportunities";
import {
  fetchUpcomingForLeague,
  NEXT_MATCHES_LEAGUES,
} from "@/lib/football-api/fetch-upcoming-league";

export const maxDuration = 120;
export const runtime = "nodejs";

const WEEKEND_CACHE_SECONDS = 300;

function apiSeasonFallback(): number {
  const d = new Date();
  return d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const refresh =
      url.searchParams.get("refresh") === "1" ||
      url.searchParams.get("refresh") === "true";

    const portfolioShadow =
      url.searchParams.get("portfolioShadow") === "1" ||
      url.searchParams.get("portfolioShadow") === "true";

    const leagueResults = await Promise.all(
      NEXT_MATCHES_LEAGUES.map((league) =>
        fetchUpcomingForLeague({ league, next: 50, refresh }).catch((e) => ({
          season: apiSeasonFallback(),
          league,
          leagueId: 0,
          fixtures: [] as Awaited<
            ReturnType<typeof fetchUpcomingForLeague>
          >["fixtures"],
          fromCache: false,
          warning: e instanceof Error ? e.message : String(e),
          filteredCount: 0,
          filterReasons: {},
        }))
      )
    );

    const filteredCount = leagueResults.reduce(
      (n, r) => n + (r.filteredCount ?? 0),
      0
    );
    const filterReasons = sumFilterReasons(
      leagueResults.map((r) => r.filterReasons ?? {})
    );

    const allFixtures = leagueResults.flatMap((r) => r.fixtures);
    const weekendFixtures = filterWeekendFixtures(allFixtures);
    const rawBatch = buildUpcomingPredictionBatch(weekendFixtures);
    const batch = rawBatch ? normalizeWeekendBatch(rawBatch) : null;

    if (!batch || batch.matches.length === 0) {
      const warnings = leagueResults
        .filter((r) => r.warning)
        .map((r) => `${r.league}: ${r.warning}`);
      return NextResponse.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        fixturePoolCount: 0,
        selectedCount: 0,
        insufficientPool: true,
        rows: [],
        warnings: [
          ...warnings,
          "No upcoming fixtures in the next 7 days across the five leagues.",
        ],
        filteredCount,
        filterReasons,
      });
    }

    type ScoredPayload = Awaited<ReturnType<typeof buildWeekendPool>> & {
      portfolio: ReturnType<typeof curateWeekendPortfolio>;
    };

    const runScoring = async (): Promise<ScoredPayload> => {
      const pool = await buildWeekendPool({ refresh: true });
      const allBatches = await loadAllBatches().catch(
        () => [] as Awaited<ReturnType<typeof loadAllBatches>>
      );
      const portfolio = curateWeekendPortfolio({
        fixtures: pool.weekendFixtures,
        estimates: pool.estimates,
        calibrator: scored.calibrator,
        batches: allBatches,
        analysis: null,
        shadowCompare: portfolioShadow,
        reliabilityEntries: pool.reliabilityEntries,
      });
      return { ...pool, portfolio };
    };

    const dayKey = batch.date;
    const scored = refresh
      ? await runScoring()
      : await unstable_cache(runScoring, ["weekend-opportunities", dayKey], {
          revalidate: WEEKEND_CACHE_SECONDS,
        })();

    let learnerSync: WeekendLearnerSyncResult | null = null;
    try {
      learnerSync = await persistWeekendAnalysisLearnerBatches({
        baseBatch: batch,
        estimates: scored.estimates,
        weekendRows: scored.rows,
        portfolioPicks: scored.portfolio.picks,
      });
      await recomputeAndPersistLearnerStats().catch(() => {});
    } catch (e) {
      learnerSync = {
        saved: 0,
        batchIds: [],
        pendingFill: 0,
        scoredPicks: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    const warnings: string[] = [...scored.warnings];
    for (const r of leagueResults) {
      if (r.warning) warnings.push(`${r.league}: ${r.warning}`);
    }

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      window: scored.window,
      fixturePoolCount: scored.fixturePoolCount,
      selectedCount: scored.rows.length,
      insufficientPool: scored.insufficientPool,
      rows: scored.rows,
      portfolio: scored.portfolio,
      warnings,
      filteredCount,
      filterReasons,
      learnerSync,
      weekendBatchId: batch.id,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
