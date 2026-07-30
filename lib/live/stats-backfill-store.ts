/**
 * Postgres helpers for overnight historical stats backfill cursor + gap fill.
 */
import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  liveFixtures,
  matchStats,
  statsBackfillMeta,
  teamSeasonStats,
  type LiveFixture,
  type NewTeamSeasonStats,
  type StatsBackfillMeta,
  type TeamSeasonStats,
} from "@/lib/db/schema";
import {
  STATS_BACKFILL_LEAGUE_IDS,
  STATS_BACKFILL_SEASONS,
  backfillCellAt,
  type StatsBackfillPhase,
} from "./stats-backfill-constants";

const FINISHED = ["FT", "AET", "PEN"] as const;

function hasUsableStatsSql() {
  return or(
    sql`${matchStats.homeCorners} is not null`,
    sql`${matchStats.awayCorners} is not null`,
    sql`${matchStats.homeShots} is not null`,
    sql`${matchStats.awayShots} is not null`,
    sql`${matchStats.homePossession} is not null`,
    sql`${matchStats.homeXg} is not null`,
    sql`${matchStats.awayXg} is not null`,
    sql`${matchStats.homeShotsOnTarget} is not null`,
    sql`${matchStats.rawJson} is not null`
  );
}

export type StatsBackfillCursor = {
  phase: StatsBackfillPhase;
  cellIndex: number;
  leagueId: number | null;
  season: number | null;
  lastError: string | null;
  lastSummary: string | null;
  updatedAt: string;
};

function toCursor(row: StatsBackfillMeta): StatsBackfillCursor {
  return {
    phase: (row.phase as StatsBackfillPhase) || "inventory",
    cellIndex: row.cellIndex ?? 0,
    leagueId: row.leagueId ?? null,
    season: row.season ?? null,
    lastError: row.lastError ?? null,
    lastSummary: row.lastSummary ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function readBackfillCursor(): Promise<StatsBackfillCursor | null> {
  try {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(statsBackfillMeta)
      .where(eq(statsBackfillMeta.id, 1))
      .limit(1);
    return row ? toCursor(row) : null;
  } catch {
    return null;
  }
}

export async function writeBackfillCursor(input: {
  phase: StatsBackfillPhase;
  cellIndex: number;
  leagueId?: number | null;
  season?: number | null;
  lastError?: string | null;
  lastSummary?: string | null;
}): Promise<StatsBackfillCursor> {
  const db = await getDb();
  const now = new Date();
  const cell = backfillCellAt(input.cellIndex);
  const leagueId = input.leagueId ?? cell?.leagueId ?? null;
  const season = input.season ?? cell?.season ?? null;

  await db
    .insert(statsBackfillMeta)
    .values({
      id: 1,
      phase: input.phase,
      cellIndex: input.cellIndex,
      leagueId,
      season,
      lastError: input.lastError ?? null,
      lastSummary: input.lastSummary ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: statsBackfillMeta.id,
      set: {
        phase: input.phase,
        cellIndex: input.cellIndex,
        leagueId,
        season,
        lastError: input.lastError ?? null,
        lastSummary: input.lastSummary ?? null,
        updatedAt: now,
      },
    });

  return {
    phase: input.phase,
    cellIndex: input.cellIndex,
    leagueId,
    season,
    lastError: input.lastError ?? null,
    lastSummary: input.lastSummary ?? null,
    updatedAt: now.toISOString(),
  };
}

/** Finished fixtures for a league×season with no usable match_stats row. */
export async function listFinishedFixturesMissingStats(opts: {
  leagueId: number;
  season: number;
  limit: number;
}): Promise<LiveFixture[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(liveFixtures)
    .where(
      and(
        eq(liveFixtures.leagueId, opts.leagueId),
        eq(liveFixtures.season, opts.season),
        inArray(liveFixtures.status, [...FINISHED]),
        sql`NOT EXISTS (
          SELECT 1 FROM match_stats ms
          WHERE ms.fixture_id = ${liveFixtures.fixtureId}
            AND (
              ms.home_corners IS NOT NULL
              OR ms.away_corners IS NOT NULL
              OR ms.home_shots IS NOT NULL
              OR ms.away_shots IS NOT NULL
              OR ms.home_possession IS NOT NULL
              OR ms.home_xg IS NOT NULL
              OR ms.away_xg IS NOT NULL
              OR ms.home_shots_on_target IS NOT NULL
              OR ms.raw_json IS NOT NULL
            )
        )`
      )
    )
    .orderBy(asc(liveFixtures.kickoffUtc))
    .limit(opts.limit);

  return rows;
}

export async function countBackfillProgress(opts?: {
  leagueId?: number;
  season?: number;
}): Promise<{
  inventoryFixtures: number;
  filledWithStats: number;
  missingStats: number;
}> {
  const db = await getDb();
  const leagueFilter =
    opts?.leagueId != null
      ? eq(liveFixtures.leagueId, opts.leagueId)
      : inArray(liveFixtures.leagueId, STATS_BACKFILL_LEAGUE_IDS);
  const seasonFilter =
    opts?.season != null
      ? eq(liveFixtures.season, opts.season)
      : inArray(liveFixtures.season, [...STATS_BACKFILL_SEASONS]);

  const finishedWhere = and(
    leagueFilter,
    seasonFilter,
    inArray(liveFixtures.status, [...FINISHED])
  );

  const [inv] = await db
    .select({ n: count() })
    .from(liveFixtures)
    .where(finishedWhere);

  const filledRows = await db
    .select({ n: count() })
    .from(liveFixtures)
    .innerJoin(matchStats, eq(liveFixtures.fixtureId, matchStats.fixtureId))
    .where(and(finishedWhere, hasUsableStatsSql()));

  const inventoryFixtures = Number(inv?.n ?? 0);
  const filledWithStats = Number(filledRows[0]?.n ?? 0);
  return {
    inventoryFixtures,
    filledWithStats,
    missingStats: Math.max(0, inventoryFixtures - filledWithStats),
  };
}

export async function upsertTeamSeasonStatsRows(
  rows: NewTeamSeasonStats[]
): Promise<number> {
  if (!rows.length) return 0;
  const db = await getDb();
  let upserted = 0;
  for (const row of rows) {
    await db
      .insert(teamSeasonStats)
      .values(row)
      .onConflictDoUpdate({
        target: [
          teamSeasonStats.teamName,
          teamSeasonStats.leagueId,
          teamSeasonStats.season,
        ],
        set: {
          afTeamId: row.afTeamId,
          matches: row.matches,
          homeMatches: row.homeMatches,
          awayMatches: row.awayMatches,
          avgGoalsFor: row.avgGoalsFor,
          avgGoalsAgainst: row.avgGoalsAgainst,
          avgXgFor: row.avgXgFor,
          avgXgAgainst: row.avgXgAgainst,
          avgShotsFor: row.avgShotsFor,
          avgShotsAgainst: row.avgShotsAgainst,
          avgShotsOnTargetFor: row.avgShotsOnTargetFor,
          avgShotsOnTargetAgainst: row.avgShotsOnTargetAgainst,
          avgCornersFor: row.avgCornersFor,
          avgCornersAgainst: row.avgCornersAgainst,
          avgPossession: row.avgPossession,
          avgFoulsFor: row.avgFoulsFor,
          avgYellowCardsFor: row.avgYellowCardsFor,
          avgRedCardsFor: row.avgRedCardsFor,
          avgPassesFor: row.avgPassesFor,
          avgTacklesFor: row.avgTacklesFor,
          homeAvgGoalsFor: row.homeAvgGoalsFor,
          homeAvgCornersFor: row.homeAvgCornersFor,
          homeAvgShotsOnTargetFor: row.homeAvgShotsOnTargetFor,
          awayAvgGoalsFor: row.awayAvgGoalsFor,
          awayAvgCornersFor: row.awayAvgCornersFor,
          awayAvgShotsOnTargetFor: row.awayAvgShotsOnTargetFor,
          updatedAt: row.updatedAt,
        },
      });
    upserted += 1;
  }
  return upserted;
}

export async function getTeamSeasonStats(opts: {
  teamName: string;
  leagueId: number;
  season: number;
}): Promise<TeamSeasonStats | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(teamSeasonStats)
    .where(
      and(
        eq(teamSeasonStats.teamName, opts.teamName),
        eq(teamSeasonStats.leagueId, opts.leagueId),
        eq(teamSeasonStats.season, opts.season)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function listMatchStatsForLeagueSeason(
  leagueId: number,
  season: number
): Promise<
  Array<{
    homeTeam: string;
    awayTeam: string;
    homeId: number | null;
    awayId: number | null;
    homeGoals: number | null;
    awayGoals: number | null;
    homeCorners: number | null;
    awayCorners: number | null;
    homeShots: number | null;
    awayShots: number | null;
    homeShotsOnTarget: number | null;
    awayShotsOnTarget: number | null;
    homeXg: number | null;
    awayXg: number | null;
    homePossession: number | null;
    awayPossession: number | null;
    homeFouls: number | null;
    awayFouls: number | null;
    homeYellowCards: number | null;
    awayYellowCards: number | null;
    homeRedCards: number | null;
    awayRedCards: number | null;
    homePasses: number | null;
    awayPasses: number | null;
    homeTackles: number | null;
    awayTackles: number | null;
  }>
> {
  const db = await getDb();
  const rows = await db
    .select({
      homeTeam: matchStats.homeTeam,
      awayTeam: matchStats.awayTeam,
      homeId: liveFixtures.homeId,
      awayId: liveFixtures.awayId,
      homeGoals: matchStats.homeGoals,
      awayGoals: matchStats.awayGoals,
      homeCorners: matchStats.homeCorners,
      awayCorners: matchStats.awayCorners,
      homeShots: matchStats.homeShots,
      awayShots: matchStats.awayShots,
      homeShotsOnTarget: matchStats.homeShotsOnTarget,
      awayShotsOnTarget: matchStats.awayShotsOnTarget,
      homeXg: matchStats.homeXg,
      awayXg: matchStats.awayXg,
      homePossession: matchStats.homePossession,
      awayPossession: matchStats.awayPossession,
      homeFouls: matchStats.homeFouls,
      awayFouls: matchStats.awayFouls,
      homeYellowCards: matchStats.homeYellowCards,
      awayYellowCards: matchStats.awayYellowCards,
      homeRedCards: matchStats.homeRedCards,
      awayRedCards: matchStats.awayRedCards,
      homePasses: matchStats.homePasses,
      awayPasses: matchStats.awayPasses,
      homeTackles: matchStats.homeTackles,
      awayTackles: matchStats.awayTackles,
    })
    .from(matchStats)
    .leftJoin(liveFixtures, eq(matchStats.fixtureId, liveFixtures.fixtureId))
    .where(
      and(
        eq(matchStats.leagueId, leagueId),
        eq(matchStats.season, season),
        hasUsableStatsSql()
      )
    );
  return rows;
}
