/**
 * Shared Weekend Picks pool builder — used by Match Centre and OpenAI predictor.
 */
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import {
  fetchUpcomingForLeague,
  NEXT_MATCHES_LEAGUES,
} from "@/lib/football-api/fetch-upcoming-league";
import { sumFilterReasons } from "@/lib/football-api/fixture-eligibility";
import { registerMatchCentreFixtures } from "@/lib/match-centre/register-fixtures";
import {
  filterWeekendFixtures,
  rankWeekendOpportunities,
  type WeekendOpportunityRow,
} from "@/lib/match-centre/weekend-opportunities";
import { preloadMatchCentreHalfRates } from "@/lib/match-centre/team-half-rates";
import { buildUpcomingPredictionBatch } from "@/lib/prediction-log/batch-fixture-picker";
import {
  collectBatchTeamLeaguePairs,
  estimateBatchCanonicalAsync,
  type CanonicalFixtureEstimate,
} from "@/lib/prediction-log/canonical-fixture-estimate";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { loadLearnerStatsStore } from "@/lib/prediction-log/learner-stats-store";
import { loadMarketReliability } from "@/lib/prediction-log/learner-market-reliability";
import type {
  LearnerStatsStore,
  MarketReliabilityEntry,
  PredictionBatch,
} from "@/lib/prediction-log/types";
import { fitSlipCalibrator } from "@/lib/slip-builder/slip-calibration";

export const OPENAI_WEEKEND_PICK_LIMIT = 30;

function apiSeasonFallback(): number {
  const d = new Date();
  return d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

export function normalizeWeekendBatch(
  batch: NonNullable<ReturnType<typeof buildUpcomingPredictionBatch>>
): PredictionBatch {
  const weekendId = `WEEKEND-${batch.date}`;
  return {
    ...batch,
    id: weekendId,
    batchName: "Weekend Picks Pool",
    matches: batch.matches.map((m, i) => ({
      ...m,
      id: `${weekendId}-m${i + 1}`,
    })),
  };
}

export type WeekendPoolBuildResult = {
  weekendFixtures: UpcomingFixtureRow[];
  weekendBatchId: string | null;
  batch: PredictionBatch | null;
  rows: WeekendOpportunityRow[];
  topRows: WeekendOpportunityRow[];
  estimates: CanonicalFixtureEstimate[];
  calibrator: ReturnType<typeof fitSlipCalibrator>;
  learnerStats: LearnerStatsStore;
  reliabilityEntries: MarketReliabilityEntry[];
  fixturePoolCount: number;
  window: { from: string; to: string } | null;
  warnings: string[];
  filteredCount: number;
  filterReasons: Record<string, number>;
  insufficientPool: boolean;
};

export async function buildWeekendPool(opts?: {
  refresh?: boolean;
}): Promise<WeekendPoolBuildResult> {
  const refresh = opts?.refresh === true;
  void refresh;

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

  const allFixtures = leagueResults.flatMap((r) => r.fixtures);
  const filteredCount = leagueResults.reduce(
    (n, r) => n + (r.filteredCount ?? 0),
    0
  );
  const filterReasons = sumFilterReasons(
    leagueResults.map((r) => r.filterReasons ?? {})
  );
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

  const rawBatch = buildUpcomingPredictionBatch(weekendFixtures);
  const batch = rawBatch ? normalizeWeekendBatch(rawBatch) : null;

  const warnings: string[] = [];
  for (const r of leagueResults) {
    if (r.warning) warnings.push(`${r.league}: ${r.warning}`);
  }

  const emptyStats = await loadLearnerStatsStore();

  if (!batch || batch.matches.length === 0) {
    return {
      weekendFixtures,
      weekendBatchId: null,
      batch: null,
      rows: [],
      topRows: [],
      estimates: [],
      calibrator: null,
      learnerStats: emptyStats,
      reliabilityEntries: [],
      fixturePoolCount: 0,
      window: null,
      warnings: [
        ...warnings,
        "No upcoming fixtures in the next 7 days across the five leagues.",
      ],
      filteredCount,
      filterReasons,
      insufficientPool: true,
    };
  }

  const [matchCentreCache, allBatches, reliabilityEntries, learnerStats] =
    await Promise.all([
      preloadMatchCentreHalfRates(collectBatchTeamLeaguePairs(batch)).catch(
        () => undefined
      ),
      loadAllBatches().catch(
        () => [] as Awaited<ReturnType<typeof loadAllBatches>>
      ),
      loadMarketReliability().catch(() => [] as MarketReliabilityEntry[]),
      loadLearnerStatsStore(),
    ]);

  const estimates = await estimateBatchCanonicalAsync(batch, [batch], {
    matchCentreCache,
  });
  const calibrator = fitSlipCalibrator(allBatches);
  const ranked = rankWeekendOpportunities({
    fixtures: weekendFixtures,
    estimates,
    calibrator,
  });

  return {
    weekendFixtures,
    weekendBatchId: batch.id,
    batch,
    rows: ranked.rows,
    topRows: ranked.rows.slice(0, OPENAI_WEEKEND_PICK_LIMIT),
    estimates,
    calibrator,
    learnerStats,
    reliabilityEntries,
    fixturePoolCount: ranked.fixturePoolCount,
    window: ranked.window,
    warnings,
    filteredCount,
    filterReasons,
    insufficientPool: ranked.insufficientPool,
  };
}

/** Map apiFixtureId → estimate (aligned with weekendFixtures order). */
export function estimatesByFixtureId(
  fixtures: UpcomingFixtureRow[],
  estimates: CanonicalFixtureEstimate[]
): Record<string, CanonicalFixtureEstimate> {
  const out: Record<string, CanonicalFixtureEstimate> = {};
  for (let i = 0; i < fixtures.length; i++) {
    const est = estimates[i];
    if (!est) continue;
    out[`api:${fixtures[i]!.apiFixtureId}`] = est;
  }
  return out;
}
export function sliceTopWeekendRows(
  rows: WeekendOpportunityRow[],
  limit = OPENAI_WEEKEND_PICK_LIMIT
): WeekendOpportunityRow[] {
  return rows.slice(0, Math.max(0, limit));
}
