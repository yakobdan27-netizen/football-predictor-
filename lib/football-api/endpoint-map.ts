/**
 * Canonical API-Football endpoint map for this app.
 * Host: https://v3.football.api-sports.io — header x-apisports-key.
 * Season = European start year (e.g. 2025 for 2025/26). Never invent fields.
 */
import { apiFootballGet, getApiFootballKey, isApiFootballKeyError } from "./client";
import { LEAGUE_API_IDS, apiSeasonFromDate } from "./leagues";
import { normalizeFootballStatus } from "./status";
import { todayIsoDate } from "@/lib/prediction-log/batch-date";

export const API_FOOTBALL_HOST = "https://v3.football.api-sports.io";

/** Feature → endpoint contract (documentation + runtime confirm helpers). */
export const ENDPOINT_MAP = {
  schedule: {
    path: "/fixtures",
    params: "league, season, from, to (rolling 7d)",
    stores: "live_fixtures / upcoming KV",
  },
  live: {
    path: "/fixtures",
    params: "live=all | ids=",
    stores: "live_fixtures goals + status_minute",
  },
  fixtureById: {
    path: "/fixtures",
    params: "id=",
    stores: "FT/HT settlement",
  },
  events: {
    path: "/fixtures/events",
    params: "fixture=",
    stores: "live_events / goal timing",
    planNote: "May require paid plan",
  },
  statistics: {
    path: "/fixtures/statistics",
    params: "fixture=",
    stores: "corners, shots → Prediction Log teamStats",
    planNote: "May require paid plan",
  },
  teams: {
    path: "/teams",
    params: "league, season",
    stores: "roster verify",
  },
  teamStatistics: {
    path: "/teams/statistics",
    params: "league, season, team",
    stores: "optional season GF/GA enrichment",
  },
  leagues: {
    path: "/leagues",
    params: "id, season",
    stores: "confirm league ids",
  },
  status: {
    path: "/status",
    params: "(none)",
    stores: "plan + quota diagnostics",
  },
} as const;

export type LeagueConfirmRow = {
  name: string;
  expectedId: number;
  ok: boolean;
  apiName?: string | null;
  error?: string;
  planGated?: boolean;
};

export type LeagueSeasonConfirm = {
  ok: boolean;
  season: number;
  plan?: string;
  remaining?: number;
  planGated: boolean;
  reason?: string;
  leagues: LeagueConfirmRow[];
};

type LeagueApiRow = {
  league?: { id?: number; name?: string };
  seasons?: Array<{ year?: number; current?: boolean }>;
};

/**
 * Confirm hardcoded league IDs against GET /leagues and report /status plan.
 * On failure keeps hardcoded map and sets planGated — never invents IDs.
 */
export async function confirmLeaguesAndSeason(
  season?: number
): Promise<LeagueSeasonConfirm> {
  const seasonYear = season ?? apiSeasonFromDate(todayIsoDate());
  const leagues: LeagueConfirmRow[] = [];

  let plan: string | undefined;
  let remaining: number | undefined;
  let planGated = false;
  let reason: string | undefined;

  try {
    getApiFootballKey();
  } catch (e) {
    return {
      ok: false,
      season: seasonYear,
      planGated: true,
      reason: e instanceof Error ? e.message : "API key not configured",
      leagues: Object.entries(LEAGUE_API_IDS)
        .filter(([name]) =>
          [
            "Premier League",
            "La Liga",
            "Serie A",
            "Bundesliga",
            "Ligue 1",
          ].includes(name)
        )
        .map(([name, expectedId]) => ({
          name,
          expectedId,
          ok: false,
          error: "key missing",
          planGated: true,
        })),
    };
  }

  try {
    const raw = await apiFootballGet<unknown>("/status");
    const st = normalizeFootballStatus(raw);
    plan = st.plan;
    remaining = st.requests?.remaining;
    if (
      st.requests?.current != null &&
      st.requests?.limitDay != null &&
      st.requests.limitDay > 0 &&
      st.requests.current >= st.requests.limitDay
    ) {
      planGated = true;
      reason = "API quota reached";
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    planGated = true;
    reason = isApiFootballKeyError(msg)
      ? "API key invalid — check env"
      : msg;
  }

  const domestic: Array<[string, number]> = [
    ["Premier League", LEAGUE_API_IDS["Premier League"]],
    ["La Liga", LEAGUE_API_IDS["La Liga"]],
    ["Serie A", LEAGUE_API_IDS["Serie A"]],
    ["Bundesliga", LEAGUE_API_IDS.Bundesliga],
    ["Ligue 1", LEAGUE_API_IDS["Ligue 1"]],
  ];

  for (const [name, expectedId] of domestic) {
    try {
      const rows = await apiFootballGet<LeagueApiRow[]>("/leagues", {
        id: expectedId,
        season: seasonYear,
      });
      const hit = (rows ?? []).find((r) => r.league?.id === expectedId);
      if (!hit) {
        leagues.push({
          name,
          expectedId,
          ok: false,
          planGated: true,
          error: `No /leagues row for id=${expectedId} season=${seasonYear}`,
        });
        planGated = true;
      } else {
        leagues.push({
          name,
          expectedId,
          ok: true,
          apiName: hit.league?.name ?? null,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const gated = /plan|Free|season|401|403/i.test(msg);
      leagues.push({
        name,
        expectedId,
        ok: false,
        planGated: gated,
        error: msg,
      });
      if (gated) planGated = true;
      if (!reason) reason = msg;
    }
  }

  const ok = leagues.every((l) => l.ok) && !reason?.includes("quota");
  return {
    ok,
    season: seasonYear,
    plan,
    remaining,
    planGated,
    reason,
    leagues,
  };
}
