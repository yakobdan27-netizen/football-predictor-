import { DEMO_DOMESTIC_LEAGUES, DEMO_UEFA_COMPETITIONS } from "@/lib/data/demo-teams";
import {
  customTeamNamesForLeague,
  getRosterQualityStore,
} from "./teams-quality";
import type { TeamsQualityStore } from "./teams-quality-types";

const LEAGUE_ROSTERS = [...DEMO_DOMESTIC_LEAGUES, ...DEMO_UEFA_COMPETITIONS];

export function teamsForLeague(
  league: string,
  qualityStore?: TeamsQualityStore | null
): string[] {
  const group = LEAGUE_ROSTERS.find((g) => g.id === league);
  const base = group ? [...group.teams] : [];
  const store = qualityStore === undefined ? getRosterQualityStore() : qualityStore;
  const customs = customTeamNamesForLeague(league, store);
  return [...new Set([...base, ...customs])].sort();
}

export function isValidFixture(
  home: string,
  away: string,
  league: string,
  qualityStore?: TeamsQualityStore | null
): boolean {
  if (!home || !away || home === away) return false;
  const teams = new Set(teamsForLeague(league, qualityStore));
  return teams.has(home) && teams.has(away);
}
