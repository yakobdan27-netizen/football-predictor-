import { loadAllBatches, saveBatch } from "@/lib/prediction-log/club-store";
import { syncBatchToClubHistories } from "@/lib/prediction-log/club-history-writer";
import { maybeRetrainOnBatchResult } from "@/lib/prediction-log/retrain-ml";
import { maybeBayesianCalibrateOnBatch } from "@/lib/prediction-log/bayesian-calibration";
import { computeLeagueBaselines } from "@/lib/prediction-log/league-baselines";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { recomputeAndPersistLearnerStats } from "@/lib/prediction-log/learner-stats-store";
import { recomputeAndPersistLeaguePriors } from "@/lib/prediction-log/league-priors-store";
import { recomputePlSeasonCards } from "@/lib/prediction-log/pl-season-store";
import { recomputeLlSeasonCards } from "@/lib/prediction-log/ll-season-store";
import { recomputeBlSeasonCards } from "@/lib/prediction-log/bl-season-store";
import { recomputeSaSeasonCards } from "@/lib/prediction-log/sa-season-store";
import { recomputeL1SeasonCards } from "@/lib/prediction-log/l1-season-store";
import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import { scoreMatch, scoreBatch, marketsEnteredCount } from "@/lib/prediction-log/scoring";
import { matchLeague } from "@/lib/prediction-log/match-league";
import type { LogMarketKey, LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { sleep } from "./client";
import {
  fetchFixtureByIdCached,
  fetchFixtureStatisticsCached,
  fetchFixturesCached,
  seasonAndLeagueForBatchDate,
} from "./cache";
import { apiDateOnly, apiLeagueId, apiSeasonFromDate } from "./leagues";
import {
  type ApiFieldConflict,
  type ApiFootballFixture,
  type ApiFootballStatBlock,
  detectApiConflicts,
  mapFixtureToMatchUpdates,
  matchNeedsStatistics,
  mergeMatchUpdates,
} from "./map-fixture-to-match";
import { fixturePairKey } from "./team-resolve";

export interface SyncResultsSummary {
  updatedBatches: number;
  matchesSynced: number;
  matchesNotFound: number;
  errors: string[];
  conflicts: ApiFieldConflict[];
  /** True when key/API is unavailable (UI shows non-blocking banner). */
  unavailable?: boolean;
}

const FINISHED = new Set(["FT", "AET", "PEN"]);
const ABANDONED = new Set(["AB", "AWD", "WO", "CANC", "ABD"]);

function statusShort(f: ApiFootballFixture): string {
  return (f.fixture?.status?.short ?? "").trim().toUpperCase();
}

export function matchNeedsSync(match: LogMatch): boolean {
  const hg = match.teamStats?.home?.goals;
  const ag = match.teamStats?.away?.goals;
  if (hg == null || ag == null) return true;
  if (match.teamStats?.home?.corners == null || match.teamStats?.away?.corners == null) {
    return true;
  }
  for (const key of Object.keys(match.predictions) as LogMarketKey[]) {
    const actual = match.actualResults[key]?.actual;
    const scored = match.scored[key];
    if (actual == null || (typeof actual === "string" && actual.trim() === "") || scored == null) {
      return true;
    }
  }
  return false;
}

export function batchNeedsSync(batch: PredictionBatch): boolean {
  return batch.matches.some(matchNeedsSync);
}

export function indexFixtures(fixtures: ApiFootballFixture[]): Map<string, ApiFootballFixture> {
  const map = new Map<string, ApiFootballFixture>();
  for (const f of fixtures) {
    const short = statusShort(f);
    if (!FINISHED.has(short)) continue;
    const key = fixturePairKey(f.teams.home.name, f.teams.away.name);
    if (!map.has(key)) {
      map.set(key, f);
    }
  }
  return map;
}

type FetchBucket = {
  key: string;
  date: string;
  season: number;
  leagueId: number | null;
};

function bucketForMatch(batch: PredictionBatch, match: LogMatch): FetchBucket {
  const date = apiDateOnly(match.matchDate ?? batch.date);
  const league = matchLeague(match, batch.league);
  const leagueId = apiLeagueId(league);
  const season = apiSeasonFromDate(date);
  const key =
    leagueId != null
      ? `L${leagueId}:${season}:${date}`
      : `all:${season}:${date}`;
  return { key, date, season, leagueId };
}

async function loadFixtureIndex(
  bucket: FetchBucket,
  cache: Map<string, Map<string, ApiFootballFixture>>
): Promise<Map<string, ApiFootballFixture>> {
  if (cache.has(bucket.key)) return cache.get(bucket.key)!;
  const fixtures = await fetchFixturesCached({
    date: bucket.date,
    leagueId: bucket.leagueId,
    season: bucket.season,
  });
  const index = indexFixtures(fixtures);
  cache.set(bucket.key, index);
  return index;
}

async function lookupFixtureForMatch(
  batch: PredictionBatch,
  match: LogMatch,
  fixtureCache: Map<string, Map<string, ApiFootballFixture>>,
  byIdCache: Map<number, ApiFootballFixture | null>
): Promise<{ fixture: ApiFootballFixture | null; skip: boolean; status?: string }> {
  if (match.apiFixtureId != null) {
    let fixture = byIdCache.get(match.apiFixtureId);
    if (fixture === undefined) {
      fixture = await fetchFixtureByIdCached(match.apiFixtureId);
      byIdCache.set(match.apiFixtureId, fixture);
      await sleep(100);
    }
    if (!fixture) return { fixture: null, skip: false };
    const short = statusShort(fixture);
    if (ABANDONED.has(short)) {
      return { fixture, skip: true, status: short };
    }
    if (!FINISHED.has(short)) {
      return { fixture, skip: true, status: short };
    }
    return { fixture, skip: false, status: short };
  }

  const bucket = bucketForMatch(batch, match);
  let fixtureIndex = await loadFixtureIndex(bucket, fixtureCache);
  if (
    fixtureIndex.size === 0 &&
    bucket.leagueId != null &&
    !fixtureCache.has(`all:${bucket.season}:${bucket.date}`)
  ) {
    fixtureIndex = await loadFixtureIndex(
      {
        key: `all:${bucket.season}:${bucket.date}`,
        date: bucket.date,
        season: bucket.season,
        leagueId: null,
      },
      fixtureCache
    );
  }
  const key = fixturePairKey(match.homeTeam, match.awayTeam);
  return { fixture: fixtureIndex.get(key) ?? null, skip: false };
}

function applyFixtureSync(
  match: LogMatch,
  fixture: ApiFootballFixture,
  stats: ApiFootballStatBlock[] | null,
  overwrite: boolean
): { merged: LogMatch; conflicts: ApiFieldConflict[] } {
  const conflicts = overwrite
    ? []
    : detectApiConflicts(match, fixture, stats);
  const updates = mapFixtureToMatchUpdates(fixture, stats, match, { overwrite });
  let merged = mergeMatchUpdates(match, updates);
  merged = {
    ...merged,
    apiFixtureId: match.apiFixtureId ?? fixture.fixture.id,
    fixtureStatus: statusShort(fixture),
    matchDate: match.matchDate ?? apiDateOnly(fixture.fixture.date),
    homeApiTeamId: match.homeApiTeamId ?? fixture.teams.home.id,
    awayApiTeamId: match.awayApiTeamId ?? fixture.teams.away.id,
  };
  merged = applyTeamStatsSync(merged);
  merged = scoreMatch(merged);
  return { merged, conflicts };
}

export async function syncPredictionLogResults(
  batchId?: string
): Promise<SyncResultsSummary> {
  const summary: SyncResultsSummary = {
    updatedBatches: 0,
    matchesSynced: 0,
    matchesNotFound: 0,
    errors: [],
    conflicts: [],
  };

  let batches: PredictionBatch[];
  try {
    batches = await loadAllBatches();
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    summary.unavailable = true;
    return summary;
  }

  if (batchId) {
    batches = batches.filter((b) => b.id === batchId);
    if (!batches.length) {
      summary.errors.push(`Batch not found: ${batchId}`);
      return summary;
    }
  }

  const pendingBatches = batches.filter(batchNeedsSync);
  if (!pendingBatches.length) return summary;

  const fixtureCache = new Map<string, Map<string, ApiFootballFixture>>();
  const byIdCache = new Map<number, ApiFootballFixture | null>();

  for (const batch of pendingBatches) {
    let batchChanged = false;
    const updatedMatches: LogMatch[] = [];

    for (const match of batch.matches) {
      if (!matchNeedsSync(match)) {
        updatedMatches.push(match);
        continue;
      }

      let lookup: Awaited<ReturnType<typeof lookupFixtureForMatch>>;
      try {
        lookup = await lookupFixtureForMatch(batch, match, fixtureCache, byIdCache);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        summary.errors.push(`${batch.batchName}: ${msg}`);
        if (msg.includes("API_FOOTBALL_KEY") || /rate|limit|quota/i.test(msg)) {
          summary.unavailable = true;
        }
        updatedMatches.push(match);
        continue;
      }

      if (lookup.skip) {
        if (lookup.status && lookup.status !== match.fixtureStatus) {
          updatedMatches.push({ ...match, fixtureStatus: lookup.status });
          batchChanged = true;
        } else {
          updatedMatches.push(match);
        }
        continue;
      }

      const fixture = lookup.fixture;
      if (!fixture) {
        summary.matchesNotFound++;
        updatedMatches.push(match);
        continue;
      }

      let stats: ApiFootballStatBlock[] | null = null;
      if (matchNeedsStatistics(match)) {
        stats = await fetchFixtureStatisticsCached(fixture.fixture.id);
        await sleep(150);
      }

      const { merged, conflicts } = applyFixtureSync(match, fixture, stats, false);
      if (conflicts.length) summary.conflicts.push(...conflicts);

      if (JSON.stringify(merged) !== JSON.stringify(match)) {
        batchChanged = true;
        summary.matchesSynced++;
      }
      updatedMatches.push(merged);
    }

    if (!batchChanged) continue;

    let updatedBatch: PredictionBatch = scoreBatch({ ...batch, matches: updatedMatches });
    const entered = marketsEnteredCount(updatedBatch);
    if (entered.total > 0 && entered.scored === entered.total) {
      updatedBatch = {
        ...updatedBatch,
        recommendationStatus:
          updatedBatch.batchKind === "recommended" ? "SETTLED" : updatedBatch.recommendationStatus,
        settledAt:
          updatedBatch.batchKind === "recommended"
            ? new Date().toISOString()
            : updatedBatch.settledAt,
      };
    }

    try {
      const allBatches = await loadAllBatches();
      const leagueBaselines = computeLeagueBaselines(allBatches);
      const teamsQuality = await loadTeamsQualityStore().catch(() => null);
      const synced = await syncBatchToClubHistories(updatedBatch, {
        leagueBaselines,
        teamsQuality,
      });
      await saveBatch(synced);
      await maybeRetrainOnBatchResult(synced).catch(() => null);
      await maybeBayesianCalibrateOnBatch(synced).catch(() => null);
      summary.updatedBatches++;
    } catch (e) {
      summary.errors.push(
        `Failed to save ${batch.batchName}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  if (summary.updatedBatches > 0) {
    await recomputeAndPersistLearnerStats().catch(() => null);
    await recomputeAndPersistLeaguePriors().catch(() => null);
    await recomputePlSeasonCards().catch(() => null);
    await recomputeLlSeasonCards().catch(() => null);
    await recomputeBlSeasonCards().catch(() => null);
    await recomputeSaSeasonCards().catch(() => null);
    await recomputeL1SeasonCards().catch(() => null);
  }

  return summary;
}

/** Apply API values overwriting manual fields for selected matches (Replace). */
export async function replaceMatchResultsFromApi(
  batchId: string,
  matchIds: string[]
): Promise<SyncResultsSummary> {
  const summary: SyncResultsSummary = {
    updatedBatches: 0,
    matchesSynced: 0,
    matchesNotFound: 0,
    errors: [],
    conflicts: [],
  };

  const all = await loadAllBatches();
  const batch = all.find((b) => b.id === batchId);
  if (!batch) {
    summary.errors.push(`Batch not found: ${batchId}`);
    return summary;
  }

  const want = new Set(matchIds);
  const fixtureCache = new Map<string, Map<string, ApiFootballFixture>>();
  const byIdCache = new Map<number, ApiFootballFixture | null>();
  let changed = false;
  const updatedMatches: LogMatch[] = [];

  for (const match of batch.matches) {
    if (!want.has(match.id)) {
      updatedMatches.push(match);
      continue;
    }

    let lookup: Awaited<ReturnType<typeof lookupFixtureForMatch>>;
    try {
      lookup = await lookupFixtureForMatch(batch, match, fixtureCache, byIdCache);
    } catch (e) {
      summary.errors.push(e instanceof Error ? e.message : String(e));
      summary.unavailable = true;
      updatedMatches.push(match);
      continue;
    }

    if (lookup.skip || !lookup.fixture) {
      summary.matchesNotFound++;
      updatedMatches.push(
        lookup.status
          ? { ...match, fixtureStatus: lookup.status }
          : match
      );
      continue;
    }

    const stats = await fetchFixtureStatisticsCached(lookup.fixture.fixture.id);
    const { merged } = applyFixtureSync(match, lookup.fixture, stats, true);
    changed = true;
    summary.matchesSynced++;
    updatedMatches.push(merged);
  }

  if (!changed) return summary;

  const updatedBatch = scoreBatch({ ...batch, matches: updatedMatches });
  const leagueBaselines = computeLeagueBaselines(all);
  const teamsQuality = await loadTeamsQualityStore().catch(() => null);
  const synced = await syncBatchToClubHistories(updatedBatch, {
    leagueBaselines,
    teamsQuality,
  });
  await saveBatch(synced);
  summary.updatedBatches = 1;
  await recomputeAndPersistLearnerStats().catch(() => null);
  await recomputeAndPersistLeaguePriors().catch(() => null);
  await recomputePlSeasonCards().catch(() => null);
  await recomputeLlSeasonCards().catch(() => null);
  await recomputeBlSeasonCards().catch(() => null);
  await recomputeSaSeasonCards().catch(() => null);
  await recomputeL1SeasonCards().catch(() => null);
  return summary;
}

export { seasonAndLeagueForBatchDate };
