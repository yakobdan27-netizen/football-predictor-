/**
 * GET /teams/statistics — optional season GF/GA enrichment.
 * Never invents numbers; returns nulls when API omits fields or plan blocks.
 */
import { apiFootballGet } from "./client";
import { getJson, setJsonEx } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";

export interface TeamSeasonStatistics {
  teamId: number;
  leagueId: number;
  season: number;
  played: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  planGated?: boolean;
  error?: string;
}

type StatsPayload = {
  team?: { id?: number };
  fixtures?: { played?: { total?: number | null } };
  goals?: {
    for?: { total?: { total?: number | null } };
    against?: { total?: { total?: number | null } };
  };
};

const TTL = 12 * 60 * 60;

function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  return null;
}

export async function fetchTeamSeasonStatistics(
  leagueId: number,
  season: number,
  teamId: number
): Promise<TeamSeasonStatistics> {
  const cacheKey = KV_KEYS.apiFootballTeamStatistics(leagueId, season, teamId);
  const cached = await getJson<TeamSeasonStatistics>(cacheKey);
  if (cached) return cached;

  try {
    const raw = await apiFootballGet<StatsPayload>("/teams/statistics", {
      league: leagueId,
      season,
      team: teamId,
    });
    const row: TeamSeasonStatistics = {
      teamId,
      leagueId,
      season,
      played: asInt(raw?.fixtures?.played?.total),
      goalsFor: asInt(raw?.goals?.for?.total?.total),
      goalsAgainst: asInt(raw?.goals?.against?.total?.total),
    };
    await setJsonEx(cacheKey, row, TTL);
    return row;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const planGated = /plan|Free|season|401|403/i.test(msg);
    return {
      teamId,
      leagueId,
      season,
      played: null,
      goalsFor: null,
      goalsAgainst: null,
      planGated,
      error: msg,
    };
  }
}

/** Read cached stats only — no API call (safe for card recompute). */
export async function getCachedTeamSeasonStatistics(
  leagueId: number,
  season: number,
  teamId: number
): Promise<TeamSeasonStatistics | null> {
  return getJson<TeamSeasonStatistics>(
    KV_KEYS.apiFootballTeamStatistics(leagueId, season, teamId)
  );
}
