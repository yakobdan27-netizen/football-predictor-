/**
 * KV-backed team name → API-Football team id map (per league + season).
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { getJson, setJson } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";
import { apiFootballGet } from "./client";
import { LEAGUE_API_IDS, apiLeagueId, apiSeasonFromDate } from "./leagues";

export interface TeamIdMapStore {
  schemaVersion: number;
  leagueId: number;
  season: number;
  /** Normalized display name → API team id */
  byName: Record<string, number>;
  /** Alphanumeric key → API team id (for fuzzy) */
  byKey: Record<string, number>;
  updatedAt: string;
}

export const TEAM_ID_MAP_SCHEMA = 1;

export function teamNameKey(name: string): string {
  return standardizeTeamName(name)
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]/g, "");
}

interface ApiTeamRow {
  team?: { id?: number; name?: string };
}

export async function loadTeamIdMap(
  leagueId: number,
  season: number
): Promise<TeamIdMapStore | null> {
  return getJson<TeamIdMapStore>(KV_KEYS.apiFootballTeamMap(leagueId, season));
}

export async function saveTeamIdMap(store: TeamIdMapStore): Promise<void> {
  await setJson(KV_KEYS.apiFootballTeamMap(store.leagueId, store.season), store);
}

export async function refreshTeamIdMap(
  leagueId: number,
  season: number
): Promise<TeamIdMapStore> {
  const rows = await apiFootballGet<ApiTeamRow[]>("/teams", {
    league: leagueId,
    season,
  });
  const byName: Record<string, number> = {};
  const byKey: Record<string, number> = {};
  for (const row of rows ?? []) {
    const id = row.team?.id;
    const name = row.team?.name?.trim();
    if (id == null || !name) continue;
    const display = standardizeTeamName(name);
    byName[display] = id;
    byName[name] = id;
    byKey[teamNameKey(display)] = id;
    byKey[teamNameKey(name)] = id;
  }
  const store: TeamIdMapStore = {
    schemaVersion: TEAM_ID_MAP_SCHEMA,
    leagueId,
    season,
    byName,
    byKey,
    updatedAt: new Date().toISOString(),
  };
  await saveTeamIdMap(store);
  return store;
}

export async function ensureTeamIdMap(
  leagueId: number,
  season: number
): Promise<TeamIdMapStore> {
  const existing = await loadTeamIdMap(leagueId, season);
  if (existing && Object.keys(existing.byKey).length > 0) return existing;
  return refreshTeamIdMap(leagueId, season);
}

export interface TeamIdLookupResult {
  teamId: number | null;
  suggestions: string[];
}

function fuzzySuggestions(store: TeamIdMapStore, key: string): string[] {
  const out: string[] = [];
  for (const [name, id] of Object.entries(store.byName)) {
    const nk = teamNameKey(name);
    if (nk.includes(key) || key.includes(nk)) {
      if (!out.includes(name)) out.push(name);
    }
    void id;
  }
  return out.slice(0, 5);
}

export function lookupTeamIdInMap(
  store: TeamIdMapStore,
  teamName: string
): TeamIdLookupResult {
  const display = standardizeTeamName(teamName.trim());
  if (store.byName[display] != null) {
    return { teamId: store.byName[display]!, suggestions: [] };
  }
  if (store.byName[teamName.trim()] != null) {
    return { teamId: store.byName[teamName.trim()]!, suggestions: [] };
  }
  const key = teamNameKey(display);
  if (store.byKey[key] != null) {
    return { teamId: store.byKey[key]!, suggestions: [] };
  }

  const fuzzyIds = new Map<number, string>();
  for (const [name, id] of Object.entries(store.byName)) {
    const nk = teamNameKey(name);
    if (nk.includes(key) || (key.length >= 4 && key.includes(nk))) {
      fuzzyIds.set(id, name);
    }
  }
  if (fuzzyIds.size === 1) {
    const [id] = fuzzyIds.keys();
    return { teamId: id!, suggestions: [] };
  }
  return {
    teamId: null,
    suggestions: fuzzyIds.size > 1
      ? [...fuzzyIds.values()].slice(0, 5)
      : fuzzySuggestions(store, key),
  };
}

/** Resolve team name → API id; refresh map once on miss. */
export async function resolveApiTeamId(opts: {
  teamName: string;
  league?: string | null;
  season?: number;
}): Promise<TeamIdLookupResult & { leagueId: number | null; season: number }> {
  const season = opts.season ?? apiSeasonFromDate(new Date().toISOString().slice(0, 10));
  let leagueId = opts.league ? apiLeagueId(opts.league) : null;

  const tryLeague = async (lid: number): Promise<TeamIdLookupResult> => {
    let store = await ensureTeamIdMap(lid, season);
    let hit = lookupTeamIdInMap(store, opts.teamName);
    if (hit.teamId != null) return hit;
    store = await refreshTeamIdMap(lid, season);
    return lookupTeamIdInMap(store, opts.teamName);
  };

  if (leagueId != null) {
    const hit = await tryLeague(leagueId);
    return { ...hit, leagueId, season };
  }

  // Search major domestic leagues when league unknown
  const major = [
    LEAGUE_API_IDS["Premier League"],
    LEAGUE_API_IDS["La Liga"],
    LEAGUE_API_IDS["Serie A"],
    LEAGUE_API_IDS.Bundesliga,
    LEAGUE_API_IDS["Ligue 1"],
  ];
  const allSuggestions: string[] = [];
  for (const lid of major) {
    try {
      const hit = await tryLeague(lid);
      if (hit.teamId != null) {
        return { ...hit, leagueId: lid, season };
      }
      allSuggestions.push(...hit.suggestions);
    } catch {
      /* skip unavailable league */
    }
  }
  return {
    teamId: null,
    suggestions: [...new Set(allSuggestions)].slice(0, 5),
    leagueId: null,
    season,
  };
}
