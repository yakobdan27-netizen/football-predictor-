import { DEMO_LEAGUE_GROUPS, EUROPEAN_CLUB_POOL } from "@/lib/data/demo-teams";
import type { MatchRow } from "./types";

const MIN_ROWS = 20;

const europeanClubSet = new Set<string>(EUROPEAN_CLUB_POOL);

function leagueTeamSet(home: string, away: string): Set<string> | null {
  for (const group of DEMO_LEAGUE_GROUPS) {
    const set = new Set<string>(group.teams);
    if (set.has(home) && set.has(away)) return set;
  }
  if (europeanClubSet.has(home) && europeanClubSet.has(away)) {
    return europeanClubSet;
  }
  return null;
}

/** Restrict training data to the competition both teams belong to (or their connected component). */
export function filterRowsForFixture(
  rows: MatchRow[],
  home: string,
  away: string
): MatchRow[] {
  const league = leagueTeamSet(home, away);
  if (league) {
    const filtered = rows.filter(
      (r) => league.has(r.HomeTeam) && league.has(r.AwayTeam)
    );
    if (filtered.length >= MIN_ROWS) return filtered;
  }

  const teams = new Set<string>([home, away]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows) {
      if (teams.has(r.HomeTeam) || teams.has(r.AwayTeam)) {
        if (!teams.has(r.HomeTeam)) {
          teams.add(r.HomeTeam);
          changed = true;
        }
        if (!teams.has(r.AwayTeam)) {
          teams.add(r.AwayTeam);
          changed = true;
        }
      }
    }
  }

  const connected = rows.filter(
    (r) => teams.has(r.HomeTeam) && teams.has(r.AwayTeam)
  );
  return connected.length >= MIN_ROWS ? connected : rows;
}
