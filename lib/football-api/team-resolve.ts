import { standardizeTeamName } from "@/lib/data/team-names";
import { teamsForLeague } from "@/lib/prediction-log/teams";

function normKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeApiTeamName(name: string): string {
  return standardizeTeamName(name);
}

export function resolveToAppTeam(apiName: string, league: string): string | null {
  const teams = teamsForLeague(league);
  if (!teams.length) return null;

  const normalized = normalizeApiTeamName(apiName);
  if (teams.includes(normalized)) return normalized;

  const key = normKey(normalized);
  for (const team of teams) {
    if (normKey(team) === key) return team;
  }

  for (const team of teams) {
    const teamKey = normKey(team);
    if (teamKey.includes(key) || key.includes(teamKey)) return team;
  }

  return null;
}

export function matchPairKey(home: string, away: string): string {
  return `${normKey(home)}|${normKey(away)}`;
}

/** Normalized home|away key for API sync matching (alias-aware, no league roster). */
export function fixturePairKey(home: string, away: string): string {
  return matchPairKey(normalizeApiTeamName(home), normalizeApiTeamName(away));
}
