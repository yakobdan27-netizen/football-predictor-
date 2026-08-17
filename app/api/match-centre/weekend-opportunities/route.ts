import { NextResponse } from "next/server";
import {
  fetchUpcomingForLeague,
  NEXT_MATCHES_LEAGUES,
} from "@/lib/football-api/fetch-upcoming-league";
import { registerMatchCentreFixtures } from "@/lib/match-centre/register-fixtures";
import {
  filterWeekendFixtures,
  rankWeekendOpportunities,
} from "@/lib/match-centre/weekend-opportunities";
import { preloadMatchCentreHalfRates } from "@/lib/match-centre/team-half-rates";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { buildUpcomingPredictionBatch } from "@/lib/prediction-log/batch-fixture-picker";
import {
  collectBatchTeamLeaguePairs,
  estimateBatchCanonicalAsync,
} from "@/lib/prediction-log/canonical-fixture-estimate";
import { fitSlipCalibrator } from "@/lib/slip-builder/slip-calibration";

export const maxDuration = 120;
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const refresh =
      url.searchParams.get("refresh") === "1" ||
      url.searchParams.get("refresh") === "true";

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
        }))
      )
    );

    const allFixtures = leagueResults.flatMap((r) => r.fixtures);
    const weekendFixtures = filterWeekendFixtures(allFixtures);

    if (weekendFixtures.length > 0) {
      registerMatchCentreFixtures(
        weekendFixtures.map((f) => ({
          apiFixtureId: f.apiFixtureId,
          kickoffIso: f.kickoffIso,
          matchDate: f.matchDate,
          status: f.status,
          home: f.home,
          away: f.away,
          venue: f.venue,
          leagueId: f.leagueId,
          league: f.league,
        }))
      ).catch(() => {});
    }

    const batch = buildUpcomingPredictionBatch(weekendFixtures, {
      batchId: `WEEKEND-${new Date().toISOString().slice(0, 10)}`,
    });

    if (!batch || batch.matches.length === 0) {
      return NextResponse.json({
        ok: true,
        generatedAt: new Date().toISOString(),
        fixturePoolCount: 0,
        selectedCount: 0,
        insufficientPool: false,
        rows: [],
        warnings: [
          "No Sat–Sun fixtures in the next 7 days across the five leagues.",
        ],
        leagueErrors: leagueResults
          .filter((r) => r.warning)
          .map((r) => `${r.league}: ${r.warning}`),
      });
    }

    let matchCentreCache;
    try {
      matchCentreCache = await preloadMatchCentreHalfRates(
        collectBatchTeamLeaguePairs(batch)
      );
    } catch {
      matchCentreCache = undefined;
    }

    const estimates = await estimateBatchCanonicalAsync(batch, [batch], {
      matchCentreCache,
    });

    const allBatches = await loadAllBatches().catch(() => []);
    const calibrator = fitSlipCalibrator(allBatches);

    const result = rankWeekendOpportunities({
      fixtures: weekendFixtures,
      estimates,
      calibrator,
    });

    const warnings: string[] = [];
    if (result.insufficientPool) {
      warnings.push(
        `Only ${result.fixturePoolCount} weekend fixtures found (minimum target is 10). Showing all available.`
      );
    }
    for (const r of leagueResults) {
      if (r.warning) warnings.push(`${r.league}: ${r.warning}`);
    }

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      window: result.window,
      fixturePoolCount: result.fixturePoolCount,
      selectedCount: result.selectedCount,
      insufficientPool: result.insufficientPool,
      rows: result.rows,
      warnings,
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

function apiSeasonFallback(): number {
  const d = new Date();
  return d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}
