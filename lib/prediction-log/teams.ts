import { DEMO_DOMESTIC_LEAGUES, DEMO_UEFA_COMPETITIONS } from "@/lib/data/demo-teams";
import {
  customTeamNamesForLeague,
  getRosterQualityStore,
} from "./teams-quality";
import type { TeamsQualityStore } from "./teams-quality-types";
import {
  PL_2026_27_PROVISIONAL_TEAMS,
  PL_LEAGUE_NAME,
  PL_SEASON_2026_27,
  type PlSeasonRosterStore,
} from "./pl-season-roster";
import {
  LL_2026_27_PROVISIONAL_TEAMS,
  LL_LEAGUE_NAME,
  LL_SEASON_2026_27,
  type LlSeasonRosterStore,
} from "./ll-season-roster";
import {
  BL_LEAGUE_NAME,
  BL_SEASON_2026_27,
  type BlSeasonRosterStore,
} from "./bl-season-roster";
import { seasonForDate } from "./season";

const LEAGUE_ROSTERS = [...DEMO_DOMESTIC_LEAGUES, ...DEMO_UEFA_COMPETITIONS];

/**
 * Roster for a league. When PL/LL/BL + 2026/27, use the season-scoped
 * club list (verified or provisional) instead of the multi-season demo pool.
 * Bundesliga returns store teams only (API-first — empty until verify).
 */
export function teamsForLeague(
  league: string,
  qualityStore?: TeamsQualityStore | null,
  opts?: {
    season?: string | null;
    matchDate?: string | null;
    plRoster?: PlSeasonRosterStore | null;
    llRoster?: LlSeasonRosterStore | null;
    blRoster?: BlSeasonRosterStore | null;
  }
): string[] {
  const season =
    opts?.season ??
    (opts?.matchDate ? seasonForDate(opts.matchDate) : null);

  if (league === PL_LEAGUE_NAME && season === PL_SEASON_2026_27) {
    const fromStore = opts?.plRoster?.teams?.length
      ? opts.plRoster.teams
      : PL_2026_27_PROVISIONAL_TEAMS;
    return [...new Set(fromStore)].sort();
  }

  if (league === LL_LEAGUE_NAME && season === LL_SEASON_2026_27) {
    const fromStore = opts?.llRoster?.teams?.length
      ? opts.llRoster.teams
      : LL_2026_27_PROVISIONAL_TEAMS;
    return [...new Set(fromStore)].sort();
  }

  if (league === BL_LEAGUE_NAME && season === BL_SEASON_2026_27) {
    const fromStore = opts?.blRoster?.teams?.length ? opts.blRoster.teams : [];
    return [...new Set(fromStore)].sort();
  }

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
  qualityStore?: TeamsQualityStore | null,
  opts?: {
    season?: string | null;
    matchDate?: string | null;
    plRoster?: PlSeasonRosterStore | null;
    llRoster?: LlSeasonRosterStore | null;
    blRoster?: BlSeasonRosterStore | null;
  }
): boolean {
  if (!home || !away || home === away) return false;
  const teams = new Set(teamsForLeague(league, qualityStore, opts));
  return teams.has(home) && teams.has(away);
}
