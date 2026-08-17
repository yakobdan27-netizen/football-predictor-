/**
 * Match Centre automatic result sync — live_* + bet settlement only.
 * Must not import prediction-log / trace-fixture-by-pair / sync-prediction-log.
 */
import { sleep } from "@/lib/football-api/client";
import { LEAGUE_API_IDS, apiSeasonFromDate } from "@/lib/football-api/leagues";
import { ensureBetSettlementRegistered } from "@/lib/bets/register-settlement";
import { settleAllOpenFinished } from "@/lib/bets/settle";
import { LIVE_SYNC_LEAGUES } from "@/lib/live/constants";
import { addDaysIso, todayIsoDate } from "@/lib/live/dates";
import { apiSportsLiveProvider } from "@/lib/live/provider";
import { runLivePoll } from "@/lib/live/sync-live";
import { applyApiFixtures } from "@/lib/live/sync-apply";
import {
  registerMatchCentreFixtures,
  type MatchCentreFixtureInput,
} from "./register-fixtures";

export type MatchCentreResultSyncSummary = {
  ok: boolean;
  registered: number;
  pollUpserted: number;
  pollSettledEmitted: number;
  catchUpFetched: number;
  catchUpUpserted: number;
  catchUpSettledEmitted: number;
  catchUpEventsHydrated: number;
  settledFixtures: number;
  settledSelections: number;
  settledSlips: number;
  errors: string[];
};

function mapApiFixtureToInput(
  f: Awaited<ReturnType<typeof apiSportsLiveProvider.fetchDateRange>>[number],
  leagueName: string
): MatchCentreFixtureInput | null {
  const id = f.fixture?.id;
  const date = f.fixture?.date;
  const home = f.teams?.home?.name?.trim();
  const away = f.teams?.away?.name?.trim();
  const leagueId = f.league?.id;
  if (id == null || !date || !home || !away || leagueId == null) return null;
  return {
    apiFixtureId: id,
    kickoffIso: date,
    matchDate: date.slice(0, 10),
    status: (f.fixture.status?.short ?? "NS").trim().toUpperCase(),
    home: { id: f.teams.home.id ?? null, name: home },
    away: { id: f.teams.away.id ?? null, name: away },
    venue: f.fixture.venue?.name?.trim() || null,
    leagueId,
    league: leagueName,
  };
}

/** Seed live_fixtures from rolling 7-day schedule for all Match Centre leagues. */
export async function registerTodayFixturesFromLeagues(): Promise<number> {
  const from = todayIsoDate();
  const to = addDaysIso(from, 7);
  const season = apiSeasonFromDate(from);
  const inputs: MatchCentreFixtureInput[] = [];

  for (const name of LIVE_SYNC_LEAGUES) {
    const leagueId = LEAGUE_API_IDS[name];
    try {
      let raw = await apiSportsLiveProvider.fetchDateRange(
        leagueId,
        season,
        from,
        to
      );
      if (!raw.length) {
        raw = await apiSportsLiveProvider.fetchNext(leagueId, season, 15);
      }
      for (const f of raw) {
        const row = mapApiFixtureToInput(f, name);
        if (row) inputs.push(row);
      }
    } catch (e) {
      console.warn(
        `[match-centre] register ${name} failed:`,
        e instanceof Error ? e.message : e
      );
    }
    await sleep(200);
  }

  const { registered } = await registerMatchCentreFixtures(inputs);
  return registered;
}

/** Fetch yesterday→tomorrow and hydrate FT scores, events, corners. */
export async function syncMatchCentreFinishedCatchUp(): Promise<{
  fetched: number;
  upserted: number;
  settledEmitted: number;
  eventsHydrated: number;
  errors: string[];
}> {
  const from = addDaysIso(todayIsoDate(), -1);
  const to = addDaysIso(todayIsoDate(), 1);
  const season = apiSeasonFromDate(todayIsoDate());
  let fetched = 0;
  let upserted = 0;
  let settledEmitted = 0;
  let eventsHydrated = 0;
  const errors: string[] = [];

  for (const name of LIVE_SYNC_LEAGUES) {
    const leagueId = LEAGUE_API_IDS[name];
    try {
      const raw = await apiSportsLiveProvider.fetchDateRange(
        leagueId,
        season,
        from,
        to
      );
      const applied = await applyApiFixtures(raw, season, {
        hydrateEventsOnFt: true,
      });
      fetched += applied.fetched;
      upserted += applied.upserted;
      settledEmitted += applied.settledEmitted;
      eventsHydrated += applied.eventsHydrated;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${name}: ${msg}`);
      console.warn(`[match-centre] catch-up ${name} failed:`, msg);
    }
    await sleep(250);
  }

  return { fetched, upserted, settledEmitted, eventsHydrated, errors };
}

/** Full Match Centre result sync — cron entry point. */
export async function runMatchCentreResultSync(): Promise<MatchCentreResultSyncSummary> {
  ensureBetSettlementRegistered();
  const errors: string[] = [];

  let registered = 0;
  try {
    registered = await registerTodayFixturesFromLeagues();
  } catch (e) {
    errors.push(
      `register: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  let pollUpserted = 0;
  let pollSettledEmitted = 0;
  try {
    const poll = await runLivePoll();
    pollUpserted = poll.upserted ?? 0;
    pollSettledEmitted = poll.settledEmitted ?? 0;
    if (poll.error) errors.push(`poll: ${poll.error}`);
  } catch (e) {
    errors.push(`poll: ${e instanceof Error ? e.message : String(e)}`);
  }

  let catchUpFetched = 0;
  let catchUpUpserted = 0;
  let catchUpSettledEmitted = 0;
  let catchUpEventsHydrated = 0;
  try {
    const catchUp = await syncMatchCentreFinishedCatchUp();
    catchUpFetched = catchUp.fetched;
    catchUpUpserted = catchUp.upserted;
    catchUpSettledEmitted = catchUp.settledEmitted;
    catchUpEventsHydrated = catchUp.eventsHydrated;
    errors.push(...catchUp.errors);
  } catch (e) {
    errors.push(`catch-up: ${e instanceof Error ? e.message : String(e)}`);
  }

  let settledFixtures = 0;
  let settledSelections = 0;
  let settledSlips = 0;
  try {
    const settle = await settleAllOpenFinished();
    settledFixtures = settle.fixtures;
    settledSelections = settle.settledSelections;
    settledSlips = settle.settledSlips;
  } catch (e) {
    errors.push(`settle: ${e instanceof Error ? e.message : String(e)}`);
  }

  return {
    ok: errors.length === 0,
    registered,
    pollUpserted,
    pollSettledEmitted,
    catchUpFetched,
    catchUpUpserted,
    catchUpSettledEmitted,
    catchUpEventsHydrated,
    settledFixtures,
    settledSelections,
    settledSlips,
    errors,
  };
}
