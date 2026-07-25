/**
 * Fetch next upcoming (NS/TBD) fixtures for a league from API-Football.
 */
import { getJson, setJsonEx } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";
import { todayIsoDate } from "@/lib/prediction-log/batch-date";
import type { LeagueOption } from "@/lib/prediction-log/markets-config";
import { apiFootballGet } from "./client";
import { apiDateOnly, apiLeagueId, apiSeasonFromDate } from "./leagues";
import type { ApiFootballFixture } from "./map-fixture-to-match";
import { isUpcomingFixtureStatus } from "./resolve-upcoming-fixture";
import { normalizeApiTeamName } from "./team-resolve";

export const NEXT_MATCHES_LEAGUES = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
] as const satisfies readonly LeagueOption[];

export type NextMatchesLeague = (typeof NEXT_MATCHES_LEAGUES)[number];

export const UPCOMING_CACHE_TTL_SECONDS = 30 * 60;
export const DEFAULT_UPCOMING_NEXT = 10;

export interface UpcomingFixtureRow {
  apiFixtureId: number;
  kickoffIso: string;
  matchDate: string;
  status: string;
  home: { id: number | null; name: string; logo?: string | null };
  away: { id: number | null; name: string; logo?: string | null };
  venue: string | null;
  league: string;
  leagueId: number;
}

export interface UpcomingFixturesResult {
  season: number;
  league: string;
  leagueId: number;
  fixtures: UpcomingFixtureRow[];
  fromCache: boolean;
  /** Set when live fetch failed but stale cache was served. */
  warning?: string;
}

function kickoffMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Pure: filter NS/TBD, sort ascending, cap to `limit`. */
export function selectUpcomingFixtures(
  fixtures: ApiFootballFixture[],
  limit: number
): ApiFootballFixture[] {
  const upcoming = fixtures.filter((f) => {
    if (!f.fixture?.id || !f.fixture?.date) return false;
    return isUpcomingFixtureStatus(f.fixture.status?.short ?? "");
  });
  upcoming.sort(
    (a, b) => kickoffMs(a.fixture.date) - kickoffMs(b.fixture.date)
  );
  return upcoming.slice(0, Math.max(0, limit));
}

export function mapFixtureToUpcomingRow(
  f: ApiFootballFixture,
  league: string,
  leagueId: number
): UpcomingFixtureRow {
  const homeName = normalizeApiTeamName(f.teams.home.name);
  const awayName = normalizeApiTeamName(f.teams.away.name);
  return {
    apiFixtureId: f.fixture.id,
    kickoffIso: f.fixture.date,
    matchDate: apiDateOnly(f.fixture.date),
    status: (f.fixture.status?.short ?? "NS").trim().toUpperCase(),
    home: {
      id: f.teams.home.id ?? null,
      name: homeName,
      logo: f.teams.home.logo ?? null,
    },
    away: {
      id: f.teams.away.id ?? null,
      name: awayName,
      logo: f.teams.away.logo ?? null,
    },
    venue: f.fixture.venue?.name?.trim() || null,
    league,
    leagueId,
  };
}

export async function fetchUpcomingForLeague(opts: {
  league: string;
  next?: number;
  refresh?: boolean;
  asOfDate?: string;
}): Promise<UpcomingFixturesResult> {
  const leagueId = apiLeagueId(opts.league);
  if (leagueId == null) {
    throw new Error(`Unsupported league: ${opts.league}`);
  }
  const next = Math.min(50, Math.max(1, opts.next ?? DEFAULT_UPCOMING_NEXT));
  const asOf = opts.asOfDate ?? todayIsoDate();
  const season = apiSeasonFromDate(asOf);
  const cacheKey = KV_KEYS.apiFootballUpcoming(leagueId, season, next);

  if (!opts.refresh) {
    const cached = await getJson<UpcomingFixtureRow[]>(cacheKey);
    if (cached && Array.isArray(cached)) {
      return {
        season,
        league: opts.league,
        leagueId,
        fixtures: cached,
        fromCache: true,
      };
    }
  }

  try {
    const rows = await fetchUpcomingFixtureRows(leagueId, season, next, asOf);
    const selected = selectUpcomingFixtures(rows, next);
    const fixtures = selected.map((f) =>
      mapFixtureToUpcomingRow(f, opts.league, leagueId)
    );
    await setJsonEx(cacheKey, fixtures, UPCOMING_CACHE_TTL_SECONDS);
    return {
      season,
      league: opts.league,
      leagueId,
      fixtures,
      fromCache: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "API unavailable";
    // Stale cache is better than a hard fail — UI shows a non-blocking banner.
    const cached = await getJson<UpcomingFixtureRow[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return {
        season,
        league: opts.league,
        leagueId,
        fixtures: cached,
        fromCache: true,
        warning: msg,
      };
    }
    // Clear empty + warning (e.g. Free plan season limit) — do not invent fixtures.
    return {
      season,
      league: opts.league,
      leagueId,
      fixtures: [],
      fromCache: false,
      warning: msg,
    };
  }
}

function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Prefer `next=` (Pro+). Free plan often blocks `next` — fall back to from/to window.
 */
async function fetchUpcomingFixtureRows(
  leagueId: number,
  season: number,
  next: number,
  asOf: string
): Promise<ApiFootballFixture[]> {
  const fetchNext = Math.min(50, Math.max(next * 3, next));
  try {
    const rows = await apiFootballGet<ApiFootballFixture[]>("/fixtures", {
      league: leagueId,
      season,
      next: fetchNext,
    });
    return rows ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const nextBlocked = /next parameter|do not have access to the Next/i.test(
      msg
    );
    const seasonBlocked = /do not have access to this season/i.test(msg);
    if (seasonBlocked) throw e;
    if (!nextBlocked && !/HTTP|plan|Free/i.test(msg)) throw e;

    const from = asOf;
    const to = addDaysIso(asOf, 60);
    const rows = await apiFootballGet<ApiFootballFixture[]>("/fixtures", {
      league: leagueId,
      season,
      from,
      to,
    });
    return rows ?? [];
  }
}
