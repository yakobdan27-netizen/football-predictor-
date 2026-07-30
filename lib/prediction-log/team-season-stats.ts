/**
 * Recommendation prior reader over `team_season_stats` (DB aggregates from backfill).
 * Cold-start / enrichment only — does not replace Prediction Log hit/miss histories.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { apiLeagueId } from "@/lib/football-api/leagues";
import { ensureSchema } from "@/lib/db/init";
import { getDb } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { teamSeasonStats, type TeamSeasonStats } from "@/lib/db/schema";
import { seasonLabelFromAf } from "@/lib/live/stats-backfill-constants";
import type { CornersBaselineRow } from "./corners-baselines";

function afSeasonFromLabel(season: string): number | null {
  const m = /^(\d{4})\/(\d{2})$/.exec(season.trim());
  if (!m) return null;
  const start = parseInt(m[1]!, 10);
  return Number.isFinite(start) ? start : null;
}

export type TeamSeasonStatsPrior = {
  teamName: string;
  leagueId: number;
  season: number;
  seasonLabel: string;
  matches: number;
  avgGoalsFor: number | null;
  avgGoalsAgainst: number | null;
  avgXgFor: number | null;
  avgShotsOnTargetFor: number | null;
  avgCornersFor: number | null;
  avgCornersAgainst: number | null;
  avgPossession: number | null;
  homeAvgCornersFor: number | null;
  awayAvgCornersFor: number | null;
  source: "team_season_stats";
};

function toPrior(row: TeamSeasonStats): TeamSeasonStatsPrior {
  return {
    teamName: row.teamName,
    leagueId: row.leagueId,
    season: row.season,
    seasonLabel: seasonLabelFromAf(row.season),
    matches: row.matches,
    avgGoalsFor: row.avgGoalsFor,
    avgGoalsAgainst: row.avgGoalsAgainst,
    avgXgFor: row.avgXgFor,
    avgShotsOnTargetFor: row.avgShotsOnTargetFor,
    avgCornersFor: row.avgCornersFor,
    avgCornersAgainst: row.avgCornersAgainst,
    avgPossession: row.avgPossession,
    homeAvgCornersFor: row.homeAvgCornersFor,
    awayAvgCornersFor: row.awayAvgCornersFor,
    source: "team_season_stats",
  };
}

/** Lookup by AF league id + European start year. */
export async function lookupTeamSeasonStats(opts: {
  teamName: string;
  leagueId: number;
  season: number;
}): Promise<TeamSeasonStatsPrior | null> {
  try {
    await ensureSchema();
    const db = await getDb();
    const name = standardizeTeamName(opts.teamName);
    const [exact] = await db
      .select()
      .from(teamSeasonStats)
      .where(
        and(
          eq(teamSeasonStats.teamName, name),
          eq(teamSeasonStats.leagueId, opts.leagueId),
          eq(teamSeasonStats.season, opts.season)
        )
      )
      .limit(1);
    if (exact) return toPrior(exact);

    // Case-insensitive fallback (provider naming drift)
    const rows = await db
      .select()
      .from(teamSeasonStats)
      .where(
        and(
          eq(teamSeasonStats.leagueId, opts.leagueId),
          eq(teamSeasonStats.season, opts.season),
          sql`lower(${teamSeasonStats.teamName}) = ${name.toLowerCase()}`
        )
      )
      .limit(1);
    return rows[0] ? toPrior(rows[0]) : null;
  } catch {
    return null;
  }
}

export async function lookupTeamSeasonStatsByLeagueName(opts: {
  teamName: string;
  league: string;
  /** `2023/24` label or AF start year */
  season: string | number;
}): Promise<TeamSeasonStatsPrior | null> {
  const leagueId = apiLeagueId(opts.league);
  if (leagueId == null) return null;
  const season =
    typeof opts.season === "number"
      ? opts.season
      : afSeasonFromLabel(opts.season);
  if (season == null) return null;
  return lookupTeamSeasonStats({
    teamName: opts.teamName,
    leagueId,
    season,
  });
}

/** Map DB aggregate → corners baseline row shape for model cold-start. */
export function teamSeasonStatsToCornersBaseline(
  prior: TeamSeasonStatsPrior,
  league: string
): CornersBaselineRow | null {
  if (prior.avgCornersFor == null || prior.matches <= 0) return null;
  const won = prior.avgCornersFor;
  const conceded = prior.avgCornersAgainst ?? won;
  return {
    league,
    season: prior.seasonLabel,
    clubName: standardizeTeamName(prior.teamName),
    matches: prior.matches,
    avgCornersWon: won,
    avgCornersConceded: conceded,
    cornerDiff: Math.round((won - conceded) * 100) / 100,
    pctMatchesOver95Total: 0,
    pctMatchesOver45Team: 0,
  };
}

/**
 * Prefer DB team_season_stats when present; otherwise null (caller keeps static seed).
 */
export async function lookupDbCornersBaseline(
  clubName: string,
  league: string,
  season?: string | null
): Promise<CornersBaselineRow | null> {
  if (!season) return null;
  const prior = await lookupTeamSeasonStatsByLeagueName({
    teamName: clubName,
    league,
    season,
  });
  if (!prior) return null;
  return teamSeasonStatsToCornersBaseline(prior, league);
}
