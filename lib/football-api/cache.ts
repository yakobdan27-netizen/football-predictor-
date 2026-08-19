import { getJson, setJsonEx } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";
import { apiFootballGet } from "./client";
import {
  buildFixtureEligibilityContext,
  filterEligibleFixtures,
} from "./fixture-eligibility";
import {
  apiDateOnly,
  apiLeagueId,
  apiSeasonFromDate,
  fixturesCacheKey,
} from "./leagues";
import type { ApiFootballFixture, ApiFootballStatBlock } from "./map-fixture-to-match";
import {
  fetchFixtureGoalEvents,
  type FixtureGoalEvent,
} from "./fixture-events";
import { parseApiFootballLineups } from "./parse-fixture-lineups";
import type { MatchLineups } from "@/lib/prediction-log/types";

/** ~18h TTL — free tier friendly; re-open Result Filling hits cache. */
export const API_FOOTBALL_CACHE_TTL_SECONDS = 18 * 60 * 60;

/** Short TTL for live fixture-by-id polls (status may change). */
export const API_FOOTBALL_FIXTURE_ID_TTL_SECONDS = 15 * 60;

function isFinishedFixture(f: ApiFootballFixture): boolean {
  const short = f.fixture?.status?.short?.toUpperCase?.() ?? "";
  return short === "FT" || short === "AET" || short === "PEN";
}

export async function fetchFixturesCached(params: {
  date: string;
  leagueId: number | null;
  season: number;
}): Promise<ApiFootballFixture[]> {
  const date = apiDateOnly(params.date);
  const cacheKey = fixturesCacheKey(params.leagueId, params.season, date);
  const kvKey = KV_KEYS.apiFootballFixtures(cacheKey);

  const cached = await getJson<ApiFootballFixture[]>(kvKey);
  if (cached && Array.isArray(cached)) {
    return cached.filter(isFinishedFixture);
  }

  const query: Record<string, string | number> = {
    date,
    status: "FT",
  };
  if (params.leagueId != null) {
    query.league = params.leagueId;
    query.season = params.season;
  }

  const fixtures = await apiFootballGet<ApiFootballFixture[]>("/fixtures", query);
  let finished = (fixtures ?? []).filter(isFinishedFixture);

  if (params.leagueId != null) {
    const eligibility = await buildFixtureEligibilityContext(
      params.leagueId,
      params.season
    );
    finished = filterEligibleFixtures(finished, eligibility).kept;
  }

  await setJsonEx(kvKey, finished, API_FOOTBALL_CACHE_TTL_SECONDS);
  return finished;
}

export async function fetchFixtureByIdCached(
  fixtureId: number
): Promise<ApiFootballFixture | null> {
  const kvKey = KV_KEYS.apiFootballFixtures(`id:${fixtureId}`);
  const cached = await getJson<ApiFootballFixture>(kvKey);
  if (cached?.fixture?.id) return cached;

  const rows = await apiFootballGet<ApiFootballFixture[]>("/fixtures", {
    id: fixtureId,
  });
  const fixture = rows?.[0] ?? null;
  if (fixture) {
    await setJsonEx(kvKey, fixture, API_FOOTBALL_FIXTURE_ID_TTL_SECONDS);
  }
  return fixture;
}

export async function fetchFixtureStatisticsCached(
  fixtureId: number
): Promise<ApiFootballStatBlock[]> {
  const kvKey = KV_KEYS.apiFootballStats(fixtureId);
  const cached = await getJson<ApiFootballStatBlock[]>(kvKey);
  if (cached && Array.isArray(cached)) return cached;

  try {
    const stats = await apiFootballGet<ApiFootballStatBlock[]>("/fixtures/statistics", {
      fixture: fixtureId,
    });
    const blocks = stats ?? [];
    await setJsonEx(kvKey, blocks, API_FOOTBALL_CACHE_TTL_SECONDS);
    return blocks;
  } catch {
    return [];
  }
}

export async function fetchFixtureEventsCached(
  fixtureId: number
): Promise<{ events: FixtureGoalEvent[]; planGated: boolean }> {
  const kvKey = KV_KEYS.apiFootballEvents(fixtureId);
  const cached = await getJson<FixtureGoalEvent[]>(kvKey);
  if (cached && Array.isArray(cached)) {
    return { events: cached, planGated: false };
  }

  const result = await fetchFixtureGoalEvents(fixtureId);
  if (!result.planGated && result.events.length >= 0) {
    await setJsonEx(kvKey, result.events, API_FOOTBALL_CACHE_TTL_SECONDS);
  }
  return { events: result.events, planGated: result.planGated };
}

export async function fetchFixtureLineupsCached(
  fixtureId: number,
  opts?: { homeTeamId?: number | null; awayTeamId?: number | null }
): Promise<MatchLineups | undefined> {
  const kvKey = KV_KEYS.apiFootballLineups(fixtureId);
  const cached = await getJson<MatchLineups>(kvKey);
  if (cached?.home || cached?.away) return cached;

  try {
    const rows = await apiFootballGet<unknown[]>("/fixtures/lineups", {
      fixture: fixtureId,
    });
    const parsed = parseApiFootballLineups(rows ?? [], {
      homeTeamId: opts?.homeTeamId,
      awayTeamId: opts?.awayTeamId,
    });
    if (parsed) {
      await setJsonEx(kvKey, parsed, API_FOOTBALL_CACHE_TTL_SECONDS);
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function seasonAndLeagueForBatchDate(
  date: string,
  leagueName: string | null
): { season: number; leagueId: number | null; date: string } {
  const d = apiDateOnly(date);
  return {
    date: d,
    season: apiSeasonFromDate(d),
    leagueId: leagueName ? apiLeagueId(leagueName) : null,
  };
}
