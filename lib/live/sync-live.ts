import {
  discoverStatsApiMatches,
  fetchStatsApiMatch,
  isStatsApiConfigured,
  mapStatsApiIds,
  statsApiCompetitionIdsForAfLeagues,
} from "@/lib/stats-api";
import { apiSeasonFromDate } from "@/lib/football-api/leagues";
import { sleep } from "@/lib/football-api/client";
import { getApiFootballPlanInfo } from "@/lib/football-api/plan";
import { LIVE_LEAGUE_IDS } from "./constants";
import {
  enrichFixturesWithBeSoccer,
  STATS_API_MAX_STATS_FETCHES,
  STATS_API_STATS_GAP_MS,
} from "./enrich-besoccer";
import { mergeLiveSources } from "./merge-besoccer";
import { apiSportsLiveProvider, type LiveFixturesProvider } from "./provider";
import { applyApiFixtures, safeApply, type SyncSummary } from "./sync-apply";
import {
  listFixtureIdsNeedingLivePoll,
  getFixtureById,
  getMatchStatsByFixtureId,
  listSampleDayFromDb,
} from "./store";
import { todayIsoDate } from "./dates";
import {
  assertSampleDate,
  FREE_SAMPLE_DATE_MIN,
  resolveSampleWindow,
  type SampleWindowBounds,
} from "./sample-window";
import type { SampleDayMatch, SampleDayPreview } from "./sample-day-types";
import { emptyLiveBeSoccerEnrichment } from "./empty-enrichment";
import type { LiveApiFixture, LiveBeSoccerEnrichment } from "./types";
import type {
  ManualRefreshMode,
  ManualRefreshSummary,
  RefreshFixtureResult,
  RefreshStep,
} from "./refresh-types";

export type {
  ManualRefreshMode,
  ManualRefreshSummary,
  RefreshFixtureResult,
  RefreshStep,
  RefreshStepStatus,
} from "./refresh-types";

export type { SampleDayMatch, SampleDayPreview } from "./sample-day-types";

function emptyEnrichment(): LiveBeSoccerEnrichment {
  return emptyLiveBeSoccerEnrichment();
}

function toFixtureResults(
  raw: {
    fixture: { id: number; status?: { short?: string | null } };
    teams: { home: { name: string }; away: { name: string } };
    goals: { home: number | null; away: number | null };
  }[],
  enrichments: Map<number, LiveBeSoccerEnrichment>
): RefreshFixtureResult[] {
  return raw.map((f) => {
    const e = enrichments.get(f.fixture.id) ?? emptyEnrichment();
    return {
      fixtureId: f.fixture.id,
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      status: (f.fixture.status?.short ?? "NS").toUpperCase(),
      homeGoals: f.goals.home,
      awayGoals: f.goals.away,
      besoccerMatchId: e.besoccerMatchId,
      homeCorners: e.homeCorners,
      awayCorners: e.awayCorners,
      homeShots: e.homeShots,
      awayShots: e.awayShots,
      homePossession: e.homePossession,
      awayPossession: e.awayPossession,
      sourceConflicts: e.sourceConflicts,
    };
  });
}

function toSampleDayMatch(f: LiveApiFixture): SampleDayMatch | null {
  const fixtureId = f.fixture?.id;
  const leagueId = f.league?.id;
  if (fixtureId == null || leagueId == null) return null;
  return {
    fixtureId,
    leagueId,
    leagueName: f.league?.name ?? `League ${leagueId}`,
    kickoffUtc: f.fixture.date,
    status: (f.fixture.status?.short ?? "NS").toUpperCase(),
    homeTeam: f.teams.home.name,
    awayTeam: f.teams.away.name,
    homeGoals: f.goals?.home ?? null,
    awayGoals: f.goals?.away ?? null,
    hasMatchStats: false,
  };
}

function dbRowToSampleDayMatch(row: {
  fixture: {
    fixtureId: number;
    leagueId: number;
    homeTeam: string;
    awayTeam: string;
    kickoffUtc: Date;
    status: string;
    homeGoals: number | null;
    awayGoals: number | null;
  };
  leagueName: string | null;
  stats: {
    statsApiMatchId: string | null;
    homeCorners: number | null;
    awayCorners: number | null;
    homeShots: number | null;
    awayShots: number | null;
    homePossession: number | null;
    awayPossession: number | null;
  } | null;
}): SampleDayMatch {
  const s = row.stats;
  return {
    fixtureId: row.fixture.fixtureId,
    leagueId: row.fixture.leagueId,
    leagueName: row.leagueName ?? `League ${row.fixture.leagueId}`,
    kickoffUtc: row.fixture.kickoffUtc.toISOString(),
    status: row.fixture.status,
    homeTeam: row.fixture.homeTeam,
    awayTeam: row.fixture.awayTeam,
    homeGoals: row.fixture.homeGoals,
    awayGoals: row.fixture.awayGoals,
    hasMatchStats: s != null,
    statsApiMatchId: s?.statsApiMatchId ?? null,
    homeCorners: s?.homeCorners ?? null,
    awayCorners: s?.awayCorners ?? null,
    homeShots: s?.homeShots ?? null,
    awayShots: s?.awayShots ?? null,
    homePossession: s?.homePossession ?? null,
    awayPossession: s?.awayPossession ?? null,
  };
}

async function currentSampleWindow(): Promise<SampleWindowBounds> {
  const plan = await getApiFootballPlanInfo();
  return resolveSampleWindow(plan.isFree);
}

/**
 * Pull tracked-league fixtures for one calendar day (API-Football only).
 * Date range follows the active AF plan (free: 2022–2024; paid: wider).
 */
export async function fetchSampleDayFixtures(
  dateRaw: string,
  provider: LiveFixturesProvider = apiSportsLiveProvider
): Promise<{ date: string; season: number; fixtures: LiveApiFixture[] }> {
  const window = await currentSampleWindow();
  const date = assertSampleDate(dateRaw, window);
  const season = apiSeasonFromDate(date);
  const leagueSet = new Set(LIVE_LEAGUE_IDS);
  const byId = new Map<number, LiveApiFixture>();

  for (const leagueId of LIVE_LEAGUE_IDS) {
    try {
      const rows = await provider.fetchDateRange(leagueId, season, date, date);
      for (const row of rows) {
        if (row.fixture?.id == null) continue;
        if (row.league?.id != null && !leagueSet.has(row.league.id)) continue;
        byId.set(row.fixture.id, row);
      }
    } catch (e) {
      console.warn(
        "[sample-day] AF day fetch failed",
        leagueId,
        season,
        date,
        e instanceof Error ? e.message : e
      );
    }
  }

  const fixtures = [...byId.values()].sort((a, b) =>
    String(a.fixture.date).localeCompare(String(b.fixture.date))
  );
  return { date, season, fixtures };
}

/**
 * Preview available matches for a sample day.
 * Prefers local `live_fixtures` (+ `match_stats`) unless `forceApi` is set.
 * When the API is used, fixtures are upserted so the next load can be DB-first.
 */
export async function previewSampleDay(
  dateRaw: string,
  opts?: {
    forceApi?: boolean;
    provider?: LiveFixturesProvider;
  }
): Promise<SampleDayPreview> {
  const provider = opts?.provider ?? apiSportsLiveProvider;
  const forceApi = opts?.forceApi === true;

  try {
    const window = await currentSampleWindow();
    const date = assertSampleDate(dateRaw, window);
    const season = apiSeasonFromDate(date);

    if (!forceApi) {
      const local = await listSampleDayFromDb(date).catch(() => []);
      if (local.length > 0) {
        const matches = local.map(dbRowToSampleDayMatch);
        const withMatchStatsCount = matches.filter((m) => m.hasMatchStats).length;
        return {
          ok: true,
          date,
          season,
          matchCount: matches.length,
          matches,
          source: "database",
          withMatchStatsCount,
          forced: false,
          warning:
            withMatchStatsCount === 0
              ? "Loaded from database (no match_stats yet — use View stats or Fetch match stats)."
              : `Loaded from database (${withMatchStatsCount}/${matches.length} with match_stats).`,
        };
      }
    }

    const { fixtures } = await fetchSampleDayFixtures(date, provider);
    // Persist fixtures so subsequent previews hit the DB.
    if (fixtures.length) {
      await applyApiFixtures(fixtures, season, {
        hydrateEventsOnFt: false,
      });
    }

    // Re-read so we attach any existing match_stats rows.
    const localAfter = await listSampleDayFromDb(date).catch(() => []);
    const matches =
      localAfter.length > 0
        ? localAfter.map(dbRowToSampleDayMatch)
        : fixtures
            .map(toSampleDayMatch)
            .filter((m): m is SampleDayMatch => m != null);

    const withMatchStatsCount = matches.filter((m) => m.hasMatchStats).length;

    return {
      ok: true,
      date,
      season,
      matchCount: matches.length,
      matches,
      source: "api",
      withMatchStatsCount,
      forced: forceApi,
      warning:
        matches.length === 0
          ? `No tracked-league fixtures on ${date} (season ${season}). Pick another day in ${window.min}–${window.max}.`
          : forceApi
            ? `Forced API refresh — saved ${matches.length} fixture(s) to the database.`
            : `No local fixtures for ${date} — fetched from API and saved to the database.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      date: dateRaw,
      season: apiSeasonFromDate(dateRaw || FREE_SAMPLE_DATE_MIN),
      matchCount: 0,
      matches: [],
      source: forceApi ? "api" : "database",
      forced: forceApi,
      error: msg,
    };
  }
}

/**
 * Live poller — only hits API when matches are in-play or near kickoff.
 * Merges The Stats API match stats when STATS_API_KEY is set.
 */
export async function runLivePoll(
  provider: LiveFixturesProvider = apiSportsLiveProvider
): Promise<SyncSummary> {
  const season = apiSeasonFromDate(todayIsoDate());
  const ids = await listFixtureIdsNeedingLivePoll().catch(() => [] as number[]);

  if (!ids.length) {
    return {
      ok: true,
      upserted: 0,
      settledEmitted: 0,
      skippedRun: true,
    };
  }

  return safeApply("live-poll", async () => {
    let raw = await provider.fetchLiveAll();
    const leagueSet = new Set(LIVE_LEAGUE_IDS);
    raw = raw.filter((f) => f.league?.id != null && leagueSet.has(f.league.id));

    const liveIds = new Set(raw.map((f) => f.fixture.id));
    const missing = ids.filter((id) => !liveIds.has(id));
    if (missing.length) {
      const extra = await provider.fetchByIds(missing.slice(0, 40));
      raw = [...raw, ...extra];
    }

    const { fixtures, enrichments } = await enrichFixturesWithBeSoccer(raw);

    return applyApiFixtures(fixtures, season, {
      beSoccerEnrichments: enrichments,
    });
  });
}

/**
 * Explicit manual refresh for the /live/refresh page.
 * Only `sample-day` is supported — must pick a date in 2022–2024.
 */
export async function runManualLiveRefresh(
  opts?: {
    mode?: ManualRefreshMode;
    date?: string;
    provider?: LiveFixturesProvider;
  }
): Promise<ManualRefreshSummary> {
  const startedAt = new Date().toISOString();
  const mode: ManualRefreshMode = opts?.mode ?? "sample-day";
  const provider = opts?.provider ?? apiSportsLiveProvider;
  const beSoccerConfigured = isStatsApiConfigured();

  const steps: RefreshStep[] = [
    { id: "config", label: "Check Stats API config", status: "pending" },
    { id: "select", label: "Validate sample date", status: "pending" },
    { id: "api-football", label: "Fetch API-Football scores", status: "pending" },
    { id: "besoccer", label: "Fetch Stats API match stats", status: "pending" },
    { id: "upsert", label: "Write merged results to DB", status: "pending" },
  ];

  const base = (): Omit<ManualRefreshSummary, "ok"> => ({
    mode,
    sampleDate: opts?.date ?? null,
    upserted: 0,
    settledEmitted: 0,
    beSoccerConfigured,
    steps,
    apiFootballFetched: 0,
    beSoccerMapped: 0,
    beSoccerFetched: 0,
    beSoccerSkippedSeason: 0,
    conflictCount: 0,
    fixtures: [],
    discoverFrom: null,
    discoverTo: null,
    discoverCount: 0,
    truncated: false,
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  steps[0]!.status = "done";
  steps[0]!.detail = beSoccerConfigured
    ? "STATS_API_KEY is set (per-match /stats only — no bulk endpoint)"
    : "STATS_API_KEY not set — API-Football only";

  const window = await currentSampleWindow();

  if (mode !== "sample-day") {
    steps[1]!.status = "error";
    steps[1]!.detail = `Mode "${mode}" disabled — use sample-day with a date in ${window.min}–${window.max}`;
    return {
      ok: false,
      ...base(),
      error: `Only sample-day is supported (date ${window.min}–${window.max})`,
      finishedAt: new Date().toISOString(),
    };
  }

  try {
    steps[1]!.status = "running";
    const date = assertSampleDate(opts?.date ?? "", window);
    const season = apiSeasonFromDate(date);
    steps[1]!.status = "done";
    steps[1]!.detail = `Sample day ${date} (AF season ${season}, ${
      window.isFree ? "free-plan" : "paid-plan"
    } window ${window.min}–${window.max})`;

    steps[2]!.status = "running";
    const { fixtures: raw } = await fetchSampleDayFixtures(date, provider);
    steps[2]!.status = "done";
    steps[2]!.detail = `${raw.length} fixture(s) on ${date}`;

    if (!raw.length) {
      steps[3]!.status = "skipped";
      steps[3]!.detail = "Nothing to enrich";
      steps[4]!.status = "skipped";
      steps[4]!.detail = "No upserts";
      return {
        ok: true,
        skippedRun: true,
        ...base(),
        sampleDate: date,
        finishedAt: new Date().toISOString(),
        warning: `No tracked-league fixtures on ${date}. Pick another day after previewing.`,
      };
    }

    steps[3]!.status = "running";
    steps[4]!.status = "running";

    const competitionIds = statsApiCompetitionIdsForAfLeagues(
      raw.map((f) => f.league?.id).filter((id): id is number => id != null)
    );

    // Discover once, then persist each match as /stats returns (survives mid-run timeouts).
    let mapped = 0;
    let fetched = 0;
    let truncated = false;
    let conflictCount = 0;
    let upserted = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let settledEmitted = 0;
    let discoverCount = 0;
    const discoverFrom: string | null = date;
    const discoverTo: string | null = date;
    const allFixtures: LiveApiFixture[] = [];
    const allEnrichments = new Map<number, LiveBeSoccerEnrichment>();

    const identities = await Promise.all(
      raw.map(async (f) => {
        let cached: string | null = null;
        try {
          cached = (await getFixtureById(f.fixture.id))?.besoccerMatchId ?? null;
        } catch {
          cached = null;
        }
        return {
          fixtureId: f.fixture.id,
          homeTeam: f.teams.home.name,
          awayTeam: f.teams.away.name,
          kickoffUtc: f.fixture.date,
          statsApiMatchId: cached,
        };
      })
    );

    const dayMatches = beSoccerConfigured
      ? await discoverStatsApiMatches({
          dateFrom: date,
          dateTo: date,
          competitionIds,
        })
      : [];
    discoverCount = dayMatches.length;
    const idMap = mapStatsApiIds(identities, dayMatches);
    mapped = idMap.size;

    for (let i = 0; i < raw.length; i++) {
      const one = raw[i]!;
      const statsId = idMap.get(one.fixture.id) ?? null;
      let fx: LiveApiFixture = one;
      let enrichment: LiveBeSoccerEnrichment | null = null;

      if (!beSoccerConfigured || statsId == null) {
        enrichment = statsId ? emptyLiveBeSoccerEnrichment(statsId) : null;
      } else if (fetched >= STATS_API_MAX_STATS_FETCHES) {
        truncated = true;
        enrichment = emptyLiveBeSoccerEnrichment(statsId);
      } else {
        try {
          const match = await fetchStatsApiMatch(statsId);
          fetched += 1;
          if (match) {
            const merged = mergeLiveSources(one, match, statsId);
            fx = merged.fixture;
            enrichment = merged.enrichment;
          } else {
            enrichment = emptyLiveBeSoccerEnrichment(statsId);
          }
        } catch (e) {
          console.warn(
            "[live-refresh] /stats failed",
            statsId,
            e instanceof Error ? e.message : e
          );
          enrichment = emptyLiveBeSoccerEnrichment(statsId);
        }
        await sleep(STATS_API_STATS_GAP_MS);
      }

      allFixtures.push(fx);
      if (enrichment) {
        allEnrichments.set(one.fixture.id, enrichment);
        conflictCount += enrichment.sourceConflicts?.length ?? 0;
      }

      const applied = await applyApiFixtures([fx], season, {
        beSoccerEnrichments: enrichment
          ? new Map([[one.fixture.id, enrichment]])
          : undefined,
        hydrateEventsOnFt: false,
      });
      upserted += applied.upserted;
      inserted += applied.inserted;
      updated += applied.updated;
      skipped += applied.skipped;
      settledEmitted += applied.settledEmitted;

      steps[3]!.detail = `match ${i + 1}/${raw.length}: mapped ${mapped}, fetched ${fetched} /stats`;
      steps[4]!.detail = `upserted ${upserted} so far (inserted ${inserted}, updated ${updated})`;
    }

    steps[3]!.status = beSoccerConfigured ? "done" : "skipped";
    if (!beSoccerConfigured) {
      steps[3]!.detail = "Skipped — set STATS_API_KEY to enable";
    } else {
      steps[3]!.detail =
        `discover ${discoverFrom}→${discoverTo} (${discoverCount} listed); mapped ${mapped}; fetched ${fetched} /stats` +
        (truncated ? "; truncated at fetch cap" : "");
    }

    let dbConfirmedStats = 0;
    let dbConfirmedRows = 0;
    for (const f of allFixtures) {
      const id = f.fixture?.id;
      if (id == null) continue;
      const [liveRow, statsRow] = await Promise.all([
        getFixtureById(id).catch(() => null),
        getMatchStatsByFixtureId(id).catch(() => null),
      ]);
      if (!liveRow && !statsRow) continue;
      dbConfirmedRows += 1;
      if (
        statsRow != null ||
        liveRow?.besoccerMatchId != null ||
        liveRow?.homeCorners != null ||
        liveRow?.homeShots != null ||
        liveRow?.homePossession != null
      ) {
        dbConfirmedStats += 1;
      }
    }

    steps[4]!.status = "done";
    steps[4]!.detail = `upserted ${upserted} live_fixtures + match_stats (inserted ${inserted}, updated ${updated}); DB readback ${dbConfirmedRows}/${allFixtures.length} rows, ${dbConfirmedStats} with stats`;

    return {
      ok: true,
      mode,
      sampleDate: date,
      upserted,
      settledEmitted,
      inserted,
      updated,
      skipped,
      beSoccerConfigured,
      steps,
      apiFootballFetched: raw.length,
      beSoccerMapped: mapped,
      beSoccerFetched: fetched,
      beSoccerSkippedSeason: 0,
      conflictCount,
      fixtures: toFixtureResults(allFixtures, allEnrichments),
      discoverFrom,
      discoverTo,
      discoverCount,
      truncated,
      dbConfirmedRows,
      dbConfirmedStats,
      warning: truncated
        ? "Stats fetch capped this run (~12 req/min) — re-run or use View stats per match."
        : upserted === 0
          ? "No rows written to live_fixtures — check DB connection / schema."
          : dbConfirmedRows < allFixtures.length
            ? `Only ${dbConfirmedRows}/${allFixtures.length} fixtures confirmed in DB after upsert.`
            : undefined,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    for (const s of steps) {
      if (s.status === "running" || s.status === "pending") {
        s.status = s.status === "running" ? "error" : "skipped";
        if (s.status === "error") s.detail = msg;
      }
    }
    return {
      ok: false,
      ...base(),
      error: msg,
      warning: "Refresh failed — live_* rows unchanged for this run.",
      finishedAt: new Date().toISOString(),
    };
  }
}
