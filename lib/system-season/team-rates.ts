/**
 * Recompute per-team half rates from system_season_fixtures.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { apiLeagueId } from "@/lib/football-api/leagues";
import type { NewSystemSeasonTeamRate, SystemSeasonFixture } from "@/lib/db/schema";
import {
  listAllFixturesForLeagueSeason,
  upsertTeamRates,
  getTeamRatesByName,
} from "./store";
import { SYSTEM_SEASON_YEAR } from "./constants";

function sideHalf(
  f: SystemSeasonFixture,
  teamId: number
): { scored1h: number; scored2h: number; conc1h: number; conc2h: number } | null {
  const isHome = f.homeId === teamId;
  const isAway = f.awayId === teamId;
  if (!isHome && !isAway) return null;
  const htHome = f.htHome;
  const htAway = f.htAway;
  const ftHome = f.ftHome;
  const ftAway = f.ftAway;
  if (
    htHome == null ||
    htAway == null ||
    ftHome == null ||
    ftAway == null
  ) {
    return null;
  }
  if (isHome) {
    return {
      scored1h: htHome,
      scored2h: Math.max(0, ftHome - htHome),
      conc1h: htAway,
      conc2h: Math.max(0, ftAway - htAway),
    };
  }
  return {
    scored1h: htAway,
    scored2h: Math.max(0, ftAway - htAway),
    conc1h: htHome,
    conc2h: Math.max(0, ftHome - htHome),
  };
}

type TeamAgg = {
  teamId: number;
  teamName: string;
  n: number;
  af1: number;
  af2: number;
  da1: number;
  da2: number;
  cornersFor: number;
  cornersAgainst: number;
  hasHt: number;
};

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

export function aggregateTeamRatesFromFixtures(
  fixtures: SystemSeasonFixture[],
  leagueId: number,
  season: number = SYSTEM_SEASON_YEAR
): NewSystemSeasonTeamRate[] {
  const byTeam = new Map<number, TeamAgg>();

  function ensure(id: number, name: string): TeamAgg {
    let row = byTeam.get(id);
    if (!row) {
      row = {
        teamId: id,
        teamName: name,
        n: 0,
        af1: 0,
        af2: 0,
        da1: 0,
        da2: 0,
        cornersFor: 0,
        cornersAgainst: 0,
        hasHt: 0,
      };
      byTeam.set(id, row);
    }
    return row;
  }

  for (const f of fixtures) {
    if (!["FT", "AET", "PEN"].includes(f.status)) continue;
    if (f.homeId == null || f.awayId == null) continue;

    for (const [teamId, teamName, venue] of [
      [f.homeId, f.homeTeam, "home"] as const,
      [f.awayId, f.awayTeam, "away"] as const,
    ]) {
      const half = sideHalf(f, teamId);
      const agg = ensure(teamId, teamName);
      if (half) {
        agg.n += 1;
        agg.hasHt += 1;
        agg.af1 += half.scored1h;
        agg.af2 += half.scored2h;
        agg.da1 += half.conc1h;
        agg.da2 += half.conc2h;
      }
    }
  }

  const now = new Date();
  const out: NewSystemSeasonTeamRate[] = [];
  for (const agg of byTeam.values()) {
    if (agg.n === 0) continue;
    out.push({
      teamId: agg.teamId,
      leagueId,
      season,
      teamName: agg.teamName,
      nMatches: agg.n,
      af1: agg.hasHt > 0 ? agg.af1 / agg.hasHt : null,
      af2: agg.hasHt > 0 ? agg.af2 / agg.hasHt : null,
      da1: agg.hasHt > 0 ? agg.da1 / agg.hasHt : null,
      da2: agg.hasHt > 0 ? agg.da2 / agg.hasHt : null,
      avgCornersFor: null,
      avgCornersAgainst: null,
      dataCompleteness: agg.hasHt >= agg.n ? "full" : "partial",
      updatedAt: now,
    });
  }
  return out;
}

export async function recomputeLeagueTeamRates(
  leagueId: number,
  season: number = SYSTEM_SEASON_YEAR
): Promise<number> {
  const fixtures = await listAllFixturesForLeagueSeason(leagueId, season);
  const rows = aggregateTeamRatesFromFixtures(fixtures, leagueId, season);
  await upsertTeamRates(rows);
  return rows.length;
}

export async function recomputeTeamRatesForTeams(
  leagueId: number,
  teamIds: number[],
  season: number = SYSTEM_SEASON_YEAR
): Promise<void> {
  if (!teamIds.length) return;
  const fixtures = await listAllFixturesForLeagueSeason(leagueId, season);
  const want = new Set(teamIds);
  const filtered = fixtures.filter(
    (f) =>
      (f.homeId != null && want.has(f.homeId)) ||
      (f.awayId != null && want.has(f.awayId))
  );
  const rows = aggregateTeamRatesFromFixtures(filtered, leagueId, season);
  const full = await listAllFixturesForLeagueSeason(leagueId, season);
  const allRows = aggregateTeamRatesFromFixtures(full, leagueId, season);
  const byId = new Map(allRows.map((r) => [r.teamId, r]));
  for (const id of teamIds) {
    const row = byId.get(id);
    if (row) await upsertTeamRates([row]);
  }
}

/** Sync lookup by standardized team name for blend adapters. */
export function systemSeasonRatesCacheKey(team: string, league: string): string {
  return `${teamKey(team)}|${league}`;
}

export type SystemSeasonRatesSnapshot = {
  af1: number;
  af2: number;
  da1: number;
  da2: number;
  nMatches: number;
  teamName: string;
};

export function snapshotFromTeamRate(row: {
  af1: number | null;
  af2: number | null;
  da1: number | null;
  da2: number | null;
  nMatches: number;
  teamName: string;
}): SystemSeasonRatesSnapshot | null {
  if (
    row.nMatches <= 0 ||
    row.af1 == null ||
    row.af2 == null ||
    row.da1 == null ||
    row.da2 == null
  ) {
    return null;
  }
  return {
    af1: row.af1,
    af2: row.af2,
    da1: row.da1,
    da2: row.da2,
    nMatches: row.nMatches,
    teamName: row.teamName,
  };
}

export async function preloadSystemSeasonRates(
  pairs: { team: string; league: string }[]
): Promise<Map<string, SystemSeasonRatesSnapshot>> {
  const out = new Map<string, SystemSeasonRatesSnapshot>();
  for (const { team, league } of pairs) {
    const leagueId = apiLeagueId(league);
    if (leagueId == null) continue;
    const row = await getTeamRatesByName(team, leagueId);
    if (!row) continue;
    const snap = snapshotFromTeamRate(row);
    if (snap) {
      out.set(systemSeasonRatesCacheKey(team, league), snap);
      out.set(systemSeasonRatesCacheKey(standardizeTeamName(team), league), snap);
    }
  }
  return out;
}
