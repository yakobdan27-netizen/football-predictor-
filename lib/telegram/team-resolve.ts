import { standardizeTeamName } from "@/lib/data/team-names";
import { LEAGUE_OPTIONS } from "@/lib/prediction-log/markets-config";
import { teamsForLeague } from "@/lib/prediction-log/teams";

function norm(s: string): string {
  return standardizeTeamName(s)
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function listLeagues(): string[] {
  return [...LEAGUE_OPTIONS];
}

export function listTeams(league: string): string[] {
  return teamsForLeague(league);
}

/** Exact or fuzzy team match; returns suggestions if ambiguous/none. */
export function resolveTeamInput(
  league: string,
  input: string
): { match: string | null; suggestions: string[] } {
  const teams = listTeams(league);
  const raw = input.trim();
  if (!raw) return { match: null, suggestions: teams.slice(0, 8) };

  const standardized = standardizeTeamName(raw);
  if (teams.includes(standardized)) return { match: standardized, suggestions: [] };

  const key = norm(raw);
  const exact = teams.find((t) => norm(t) === key);
  if (exact) return { match: exact, suggestions: [] };

  const partial = teams.filter((t) => {
    const tk = norm(t);
    return tk.includes(key) || key.includes(tk);
  });
  if (partial.length === 1) return { match: partial[0]!, suggestions: [] };
  if (partial.length > 1) return { match: null, suggestions: partial.slice(0, 12) };

  // Prefix / scored suggestions
  const scored = teams
    .map((t) => {
      const tk = norm(t);
      let score = 0;
      if (tk.startsWith(key.slice(0, 3))) score += 2;
      if (key.length >= 3 && tk.includes(key.slice(0, 3))) score += 1;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.t);

  return { match: null, suggestions: (scored.length ? scored : teams).slice(0, 12) };
}

const UEFA_PREFIX = "UEFA ";

/**
 * Resolve home/away across all leagues when the user did not specify one.
 * Prefers a shared domestic league over UEFA competitions when both apply.
 */
export function resolveFixtureAcrossLeagues(
  homeInput: string,
  awayInput: string
): {
  homeTeam: string;
  awayTeam: string;
  league: string;
  ambiguous: boolean;
} | null {
  const hits: { homeTeam: string; awayTeam: string; league: string }[] = [];
  for (const league of listLeagues()) {
    const home = resolveTeamInput(league, homeInput).match;
    const away = resolveTeamInput(league, awayInput).match;
    if (!home || !away || home === away) continue;
    hits.push({ homeTeam: home, awayTeam: away, league });
  }
  if (!hits.length) return null;

  const domestic = hits.filter((h) => !h.league.startsWith(UEFA_PREFIX));
  const preferred = domestic.length ? domestic : hits;
  const first = preferred[0]!;
  return {
    ...first,
    ambiguous: hits.length > 1,
  };
}

export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
