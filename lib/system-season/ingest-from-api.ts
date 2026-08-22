/**
 * Ingest finished Big-5 fixtures into system_season_* from API-Football.
 */
import { LEAGUE_API_IDS } from "@/lib/football-api/leagues";
import { inferCompleteness } from "@/lib/hist/map";
import { sleep } from "@/lib/football-api/client";
import { LIVE_SYNC_LEAGUES } from "@/lib/live/constants";
import { addDaysIso, todayIsoDate } from "@/lib/live/dates";
import { isFinishedStatus } from "@/lib/live/normalize";
import { apiSportsLiveProvider } from "@/lib/live/provider";
import type { LiveApiFixture } from "@/lib/live/types";
import {
  SYSTEM_SEASON_MAX_ENRICH_PER_RUN,
  SYSTEM_SEASON_ENRICH_SLEEP_MS,
  SYSTEM_SEASON_YEAR,
} from "./constants";
import {
  mapSystemSeasonFixture,
  mapSystemSeasonGoals,
  mapSystemSeasonLineups,
  mapSystemSeasonStats,
} from "./map-api";
import {
  countSystemSeasonFixtures,
  fixtureNeedsEnrichment,
  getSystemSeasonFixture,
  listFixturesNeedingEnrichment,
  replaceSystemSeasonGoals,
  replaceSystemSeasonLineups,
  replaceSystemSeasonStats,
  upsertSyncMeta,
  upsertSystemSeasonFixture,
} from "./store";
import { recomputeLeagueTeamRates } from "./team-rates";

export type SystemSeasonIngestSummary = {
  ok: boolean;
  enriched: number;
  imported: number;
  skipped: number;
  errors: string[];
  leagueSummaries: Record<string, { enriched: number; total: number }>;
};

async function fetchFixtureEvents(fixtureId: number): Promise<unknown[]> {
  return apiSportsLiveProvider.fetchEvents(fixtureId);
}

async function fetchFixtureStatistics(fixtureId: number): Promise<unknown[]> {
  return apiSportsLiveProvider.fetchStatistics(fixtureId);
}

async function fetchFixtureLineups(fixtureId: number): Promise<unknown[]> {
  return apiSportsLiveProvider.fetchLineups(fixtureId);
}

async function enrichFixtureFromApi(
  raw: LiveApiFixture,
  season: number
): Promise<{ ok: boolean; error?: string }> {
  const fixtureId = raw.fixture?.id;
  if (fixtureId == null) return { ok: false, error: "missing fixture id" };

  const syncedAt = new Date();
  let events: unknown[] = [];
  let stats: unknown[] = [];
  let lineups: unknown[] = [];

  try {
    [events, stats, lineups] = await Promise.all([
      fetchFixtureEvents(fixtureId),
      fetchFixtureStatistics(fixtureId),
      fetchFixtureLineups(fixtureId),
    ]);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const goals = mapSystemSeasonGoals(fixtureId, events as never);
  const statRows = mapSystemSeasonStats(fixtureId, stats);
  const lineupRows = mapSystemSeasonLineups(fixtureId, lineups);

  const htHome = raw.score?.halftime?.home ?? null;
  const htAway = raw.score?.halftime?.away ?? null;
  const completeness = inferCompleteness({
    hasGoals: goals.length > 0,
    hasStats: statRows.length > 0,
    hasLineups: lineupRows.length > 0,
    hasHt: htHome != null && htAway != null,
    hasFt: raw.goals?.home != null && raw.goals?.away != null,
    hasCornersValue: statRows.some((s) => s.corners != null),
  });

  const row = mapSystemSeasonFixture(raw, season, completeness, syncedAt);
  if (!row) return { ok: false, error: "map fixture failed" };

  await upsertSystemSeasonFixture(row);
  if (goals.length) await replaceSystemSeasonGoals(fixtureId, goals);
  if (statRows.length) await replaceSystemSeasonStats(fixtureId, statRows);
  if (lineupRows.length) await replaceSystemSeasonLineups(fixtureId, lineupRows);

  return { ok: true };
}

async function ingestLeagueChunk(
  leagueName: string,
  season: number,
  maxFixtures: number
): Promise<{ enriched: number; errors: string[] }> {
  const leagueId = LEAGUE_API_IDS[leagueName as keyof typeof LEAGUE_API_IDS];
  if (leagueId == null) return { enriched: 0, errors: [`unknown league ${leagueName}`] };

  const errors: string[] = [];
  let enriched = 0;
  let budget = maxFixtures;

  const from = addDaysIso(todayIsoDate(), -2);
  const to = addDaysIso(todayIsoDate(), 1);

  try {
    const recent = await apiSportsLiveProvider.fetchDateRange(
      leagueId,
      season,
      from,
      to
    );
    for (const raw of recent) {
      if (budget <= 0) break;
      const short = (raw.fixture?.status?.short ?? "").toUpperCase();
      if (!isFinishedStatus(short)) continue;
      const fid = raw.fixture?.id;
      if (fid == null) continue;
      const existing = await getSystemSeasonFixture(fid);
      if (existing && !fixtureNeedsEnrichment(existing)) continue;
      const result = await enrichFixtureFromApi(raw, season);
      if (result.ok) {
        enriched += 1;
        budget -= 1;
      } else if (result.error) {
        errors.push(`${leagueName} ${fid}: ${result.error}`);
      }
      await sleep(SYSTEM_SEASON_ENRICH_SLEEP_MS);
    }
  } catch (e) {
    errors.push(`${leagueName} recent: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (budget > 0) {
    const pending = await listFixturesNeedingEnrichment(
      leagueId,
      season,
      budget
    );
    for (const row of pending) {
      if (budget <= 0) break;
      try {
        const raw = await apiSportsLiveProvider.fetchById(row.fixtureId);
        if (!raw) continue;
        const result = await enrichFixtureFromApi(raw, season);
        if (result.ok) {
          enriched += 1;
          budget -= 1;
        } else if (result.error) {
          errors.push(`${leagueName} ${row.fixtureId}: ${result.error}`);
        }
      } catch (e) {
        errors.push(
          `${leagueName} ${row.fixtureId}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      await sleep(SYSTEM_SEASON_ENRICH_SLEEP_MS);
    }
  }

  await recomputeLeagueTeamRates(leagueId, season);
  const total = await countSystemSeasonFixtures(leagueId, season);
  await upsertSyncMeta(leagueId, {
    season,
    lastRunAt: new Date(),
    lastError: errors[0] ?? null,
    fixturesSynced: total,
  });

  return { enriched, errors };
}

export async function runSystemSeasonIngest(opts?: {
  maxPerLeague?: number;
  season?: number;
}): Promise<SystemSeasonIngestSummary> {
  const season = opts?.season ?? SYSTEM_SEASON_YEAR;
  const maxPerLeague = opts?.maxPerLeague ?? SYSTEM_SEASON_MAX_ENRICH_PER_RUN;
  const summary: SystemSeasonIngestSummary = {
    ok: true,
    enriched: 0,
    imported: 0,
    skipped: 0,
    errors: [],
    leagueSummaries: {},
  };

  for (const leagueName of LIVE_SYNC_LEAGUES) {
    const leagueId = LEAGUE_API_IDS[leagueName];
    const { enriched, errors } = await ingestLeagueChunk(
      leagueName,
      season,
      maxPerLeague
    );
    summary.enriched += enriched;
    summary.errors.push(...errors);
    const total = await countSystemSeasonFixtures(leagueId, season);
    summary.leagueSummaries[leagueName] = { enriched, total };
  }

  summary.ok = summary.errors.length === 0;
  return summary;
}

/** Bootstrap: inventory full season finished fixtures, core-only first pass. */
export async function runSystemSeasonBackfill(opts?: {
  leagueName?: string;
  season?: number;
  maxFixtures?: number;
}): Promise<SystemSeasonIngestSummary> {
  const season = opts?.season ?? SYSTEM_SEASON_YEAR;
  const leagues = opts?.leagueName
    ? [opts.leagueName]
    : [...LIVE_SYNC_LEAGUES];
  const maxFixtures = opts?.maxFixtures ?? 40;
  const summary: SystemSeasonIngestSummary = {
    ok: true,
    enriched: 0,
    imported: 0,
    skipped: 0,
    errors: [],
    leagueSummaries: {},
  };

  let budget = maxFixtures;
  for (const leagueName of leagues) {
    if (budget <= 0) break;
    const leagueId = LEAGUE_API_IDS[leagueName as keyof typeof LEAGUE_API_IDS];
    if (leagueId == null) continue;

    try {
      const raw = await apiSportsLiveProvider.fetchSeasonFixtures(leagueId, season);
      for (const f of raw) {
        if (budget <= 0) break;
        const short = (f.fixture?.status?.short ?? "").toUpperCase();
        if (!isFinishedStatus(short)) continue;
        const fid = f.fixture?.id;
        if (fid == null) continue;
        const existing = await getSystemSeasonFixture(fid);
        if (existing && !fixtureNeedsEnrichment(existing)) {
          summary.skipped += 1;
          continue;
        }
        const result = await enrichFixtureFromApi(f, season);
        if (result.ok) {
          summary.enriched += 1;
          summary.imported += 1;
          budget -= 1;
        } else if (result.error) {
          summary.errors.push(`${leagueName} ${fid}: ${result.error}`);
        }
        await sleep(SYSTEM_SEASON_ENRICH_SLEEP_MS);
      }
      await recomputeLeagueTeamRates(leagueId, season);
      const total = await countSystemSeasonFixtures(leagueId, season);
      summary.leagueSummaries[leagueName] = {
        enriched: summary.enriched,
        total,
      };
      await upsertSyncMeta(leagueId, {
        season,
        lastRunAt: new Date(),
        fixturesSynced: total,
        backfillComplete: budget > 0 ? 1 : 0,
      });
    } catch (e) {
      summary.errors.push(
        `${leagueName}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  summary.ok = summary.errors.length === 0;
  return summary;
}
