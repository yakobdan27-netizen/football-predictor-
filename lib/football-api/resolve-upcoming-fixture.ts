/**
 * Resolve the nearest upcoming API-Football fixture for a home/away team pair.
 */
import { getJson, setJsonEx } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";
import { deriveBatchDateFromMatches, todayIsoDate } from "@/lib/prediction-log/batch-date";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { matchLeague } from "@/lib/prediction-log/match-league";
import { apiFootballGet } from "./client";
import { apiDateOnly, apiLeagueId, apiSeasonFromDate } from "./leagues";
import type { ApiFootballFixture } from "./map-fixture-to-match";
import { fixturePairKey } from "./team-resolve";
import { resolveApiTeamId } from "./team-id-map";

const RESOLVE_CACHE_TTL_SECONDS = 30 * 60;

export interface ResolvedFixture {
  apiFixtureId: number;
  matchDate: string;
  fixtureStatus: string;
  homeApiTeamId: number;
  awayApiTeamId: number;
  leagueId: number | null;
  kickoffIso: string;
}

export interface ResolveFixtureError {
  code: "team_not_found" | "fixture_not_found" | "api_error";
  message: string;
  suggestions?: string[];
}

export type ResolveFixtureResult =
  | { ok: true; fixture: ResolvedFixture }
  | { ok: false; error: ResolveFixtureError };

function isUpcomingStatus(short: string): boolean {
  const s = short.trim().toUpperCase();
  return s === "NS" || s === "TBD";
}

function kickoffMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

export function startOfTodayUtcMs(todayIso = todayIsoDate()): number {
  return Date.parse(`${todayIso}T00:00:00.000Z`);
}

/** Pure selection: nearest future NS/TBD fixture with matching home/away IDs. */
export function selectNearestUpcomingFixture(
  fixtures: ApiFootballFixture[],
  homeId: number,
  awayId: number,
  nowFloorMs = startOfTodayUtcMs()
): ApiFootballFixture | null {
  const candidates = fixtures.filter((f) => {
    if (!f.fixture?.id || !f.fixture?.date) return false;
    if (!isUpcomingStatus(f.fixture.status?.short ?? "")) return false;
    const hid = f.teams?.home?.id;
    const aid = f.teams?.away?.id;
    if (hid !== homeId || aid !== awayId) return false;
    const ko = kickoffMs(f.fixture.date);
    return ko >= nowFloorMs;
  });
  if (!candidates.length) return null;
  candidates.sort(
    (a, b) => kickoffMs(a.fixture.date) - kickoffMs(b.fixture.date)
  );
  return candidates[0]!;
}

function toResolved(f: ApiFootballFixture): ResolvedFixture {
  const matchDate = apiDateOnly(f.fixture.date);
  return {
    apiFixtureId: f.fixture.id,
    matchDate,
    fixtureStatus: (f.fixture.status?.short ?? "NS").trim().toUpperCase(),
    homeApiTeamId: f.teams.home.id!,
    awayApiTeamId: f.teams.away.id!,
    leagueId: f.league?.id ?? null,
    kickoffIso: f.fixture.date,
  };
}

function cacheKey(homeId: number, awayId: number, leagueId: number | null): string {
  return `${homeId}:${awayId}:${leagueId ?? "any"}`;
}

async function fetchUpcomingForTeam(
  teamId: number,
  leagueId: number | null,
  season: number
): Promise<ApiFootballFixture[]> {
  const query: Record<string, string | number> = {
    team: teamId,
    next: 20,
  };
  if (leagueId != null) {
    query.league = leagueId;
    query.season = season;
  }
  try {
    const rows = await apiFootballGet<ApiFootballFixture[]>("/fixtures", query);
    return rows ?? [];
  } catch {
    // Fallback without league filter
    if (leagueId == null) throw new Error("fixtures fetch failed");
    const rows = await apiFootballGet<ApiFootballFixture[]>("/fixtures", {
      team: teamId,
      next: 20,
    });
    return rows ?? [];
  }
}

async function fetchH2hUpcoming(
  homeId: number,
  awayId: number
): Promise<ApiFootballFixture[]> {
  try {
    const rows = await apiFootballGet<ApiFootballFixture[]>("/fixtures/headtohead", {
      h2h: `${homeId}-${awayId}`,
      next: 10,
    });
    return rows ?? [];
  } catch {
    return [];
  }
}

export async function resolveUpcomingFixture(opts: {
  homeTeam: string;
  awayTeam: string;
  league?: string | null;
}): Promise<ResolveFixtureResult> {
  const homeTeam = opts.homeTeam.trim();
  const awayTeam = opts.awayTeam.trim();
  if (!homeTeam || !awayTeam) {
    return {
      ok: false,
      error: {
        code: "fixture_not_found",
        message: "Fixture not found. Check team names.",
      },
    };
  }

  const season = apiSeasonFromDate(todayIsoDate());
  const leagueIdHint = opts.league ? apiLeagueId(opts.league) : null;

  let home: Awaited<ReturnType<typeof resolveApiTeamId>>;
  let away: Awaited<ReturnType<typeof resolveApiTeamId>>;
  try {
    home = await resolveApiTeamId({
      teamName: homeTeam,
      league: opts.league,
      season,
    });
    away = await resolveApiTeamId({
      teamName: awayTeam,
      league: opts.league ?? undefined,
      season: home.season,
    });
  } catch (e) {
    return {
      ok: false,
      error: {
        code: "api_error",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  if (home.teamId == null) {
    return {
      ok: false,
      error: {
        code: "team_not_found",
        message: `Home team not found: ${homeTeam}. Check team names.`,
        suggestions: home.suggestions,
      },
    };
  }
  if (away.teamId == null) {
    return {
      ok: false,
      error: {
        code: "team_not_found",
        message: `Away team not found: ${awayTeam}. Check team names.`,
        suggestions: away.suggestions,
      },
    };
  }

  const leagueId = leagueIdHint ?? home.leagueId ?? away.leagueId;
  const ck = cacheKey(home.teamId, away.teamId, leagueId);
  const cached = await getJson<ResolvedFixture>(KV_KEYS.apiFootballResolve(ck));
  if (cached?.apiFixtureId) {
    return { ok: true, fixture: cached };
  }

  try {
    let fixtures = await fetchUpcomingForTeam(home.teamId, leagueId, home.season);
    let picked = selectNearestUpcomingFixture(fixtures, home.teamId, away.teamId);

    if (!picked) {
      const h2h = await fetchH2hUpcoming(home.teamId, away.teamId);
      picked = selectNearestUpcomingFixture(h2h, home.teamId, away.teamId);
    }

    // Name-pair fallback if IDs present but orientation filtered nothing from next=
    if (!picked) {
      const pair = fixturePairKey(homeTeam, awayTeam);
      const all = [
        ...fixtures,
        ...(await fetchH2hUpcoming(home.teamId, away.teamId)),
      ];
      const byName = all.filter((f) => {
        if (!isUpcomingStatus(f.fixture?.status?.short ?? "")) return false;
        const ko = kickoffMs(f.fixture.date);
        if (ko < startOfTodayUtcMs()) return false;
        return (
          fixturePairKey(f.teams.home.name, f.teams.away.name) === pair
        );
      });
      byName.sort((a, b) => kickoffMs(a.fixture.date) - kickoffMs(b.fixture.date));
      picked = byName[0] ?? null;
      if (picked && (picked.teams.home.id == null || picked.teams.away.id == null)) {
        picked = {
          ...picked,
          teams: {
            home: { ...picked.teams.home, id: home.teamId },
            away: { ...picked.teams.away, id: away.teamId },
          },
        };
      }
    }

    if (!picked) {
      return {
        ok: false,
        error: {
          code: "fixture_not_found",
          message: `Fixture not found for ${homeTeam} vs ${awayTeam}. Check team names.`,
        },
      };
    }

    const resolved = toResolved(picked);
    // Ensure IDs filled
    if (!resolved.homeApiTeamId) resolved.homeApiTeamId = home.teamId;
    if (!resolved.awayApiTeamId) resolved.awayApiTeamId = away.teamId;

    await setJsonEx(KV_KEYS.apiFootballResolve(ck), resolved, RESOLVE_CACHE_TTL_SECONDS);
    return { ok: true, fixture: resolved };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: "api_error",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}

export function applyResolvedFixtureToMatch(
  match: LogMatch,
  fixture: ResolvedFixture
): LogMatch {
  return {
    ...match,
    matchDate: fixture.matchDate,
    apiFixtureId: fixture.apiFixtureId,
    fixtureStatus: fixture.fixtureStatus,
    homeApiTeamId: fixture.homeApiTeamId,
    awayApiTeamId: fixture.awayApiTeamId,
  };
}

/**
 * Resolve fixtures for every match missing apiFixtureId.
 * Throws with a user-facing message on first failure.
 */
export async function attachFixturesToBatch(
  batch: PredictionBatch
): Promise<PredictionBatch> {
  const matches: LogMatch[] = [];
  for (const match of batch.matches) {
    if (match.apiFixtureId != null && match.matchDate) {
      matches.push(match);
      continue;
    }
    const league = matchLeague(match, batch.league);
    const result = await resolveUpcomingFixture({
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      league: league === "Mixed" ? null : league,
    });
    if (!result.ok) {
      const sug =
        result.error.suggestions?.length
          ? ` Suggestions: ${result.error.suggestions.join(", ")}.`
          : "";
      throw new Error(`${result.error.message}${sug}`);
    }
    matches.push(applyResolvedFixtureToMatch(match, result.fixture));
  }
  const date = deriveBatchDateFromMatches(matches, batch.date);
  return { ...batch, matches, date };
}
