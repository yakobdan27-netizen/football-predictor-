import { LEAGUE_OPTIONS } from "./markets-config";

export interface LeagueMeta {
  leagueId: string;
  leagueName: string;
  country?: string;
}

const LEAGUE_ID_MAP: Record<string, string> = {
  "Premier League": "premier_league",
  "La Liga": "la_liga",
  "Serie A": "serie_a",
  "Bundesliga": "bundesliga",
  "Ligue 1": "ligue_1",
  "UEFA Champions League": "uefa_champions_league",
  "UEFA Europa League": "uefa_europa_league",
  "UEFA Europa Conference League": "uefa_europa_conference_league",
};

const COUNTRY_MAP: Record<string, string> = {
  premier_league: "England",
  la_liga: "Spain",
  serie_a: "Italy",
  bundesliga: "Germany",
  ligue_1: "France",
  uefa_champions_league: "Europe",
  uefa_europa_league: "Europe",
  uefa_europa_conference_league: "Europe",
};

export function slugifyLeagueId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function resolveLeagueId(leagueName: string): string {
  return LEAGUE_ID_MAP[leagueName] ?? slugifyLeagueId(leagueName);
}

export function resolveLeagueName(leagueId: string): string {
  const entry = Object.entries(LEAGUE_ID_MAP).find(([, id]) => id === leagueId);
  return entry?.[0] ?? leagueId.replace(/_/g, " ");
}

export function allLeagueMetas(): LeagueMeta[] {
  return LEAGUE_OPTIONS.map((name) => ({
    leagueId: resolveLeagueId(name),
    leagueName: name,
    country: COUNTRY_MAP[resolveLeagueId(name)],
  }));
}

export function leagueMetaForName(leagueName: string): LeagueMeta {
  const leagueId = resolveLeagueId(leagueName);
  return {
    leagueId,
    leagueName,
    country: COUNTRY_MAP[leagueId],
  };
}
