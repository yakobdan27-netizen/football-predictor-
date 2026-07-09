import { DEMO_DOMESTIC_LEAGUES, DEMO_UEFA_COMPETITIONS } from "@/lib/data/demo-teams";

const LEAGUE_ROSTERS = [...DEMO_DOMESTIC_LEAGUES, ...DEMO_UEFA_COMPETITIONS];

export function teamsForLeague(league: string): string[] {
  const group = LEAGUE_ROSTERS.find((g) => g.id === league);
  if (!group) return [];
  return [...group.teams].sort();
}

export function isValidFixture(home: string, away: string, league: string): boolean {
  if (!home || !away || home === away) return false;
  const teams = new Set(teamsForLeague(league));
  return teams.has(home) && teams.has(away);
}
