/**
 * system_season_* Postgres store — writers for lib/system-season/ only.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  systemSeasonFixtures,
  systemSeasonGoals,
  systemSeasonLineups,
  systemSeasonStats,
  systemSeasonSyncMeta,
  systemSeasonTeamRates,
  type NewSystemSeasonFixture,
  type NewSystemSeasonGoal,
  type NewSystemSeasonLineup,
  type NewSystemSeasonStat,
  type NewSystemSeasonTeamRate,
  type SystemSeasonFixture,
} from "@/lib/db/schema";
import { completenessRank, richerCompleteness } from "@/lib/hist/map";
import { SYSTEM_SEASON_YEAR } from "./constants";

export async function upsertSystemSeasonFixture(
  row: NewSystemSeasonFixture
): Promise<void> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(systemSeasonFixtures)
    .where(eq(systemSeasonFixtures.fixtureId, row.fixtureId))
    .limit(1);
  const prev = existing[0];
  if (prev?.locked) return;
  const completeness = prev
    ? richerCompleteness(
        prev.dataCompleteness ?? "core-only",
        row.dataCompleteness ?? "core-only"
      )
    : (row.dataCompleteness ?? "core-only");
  await db
    .insert(systemSeasonFixtures)
    .values({ ...row, dataCompleteness: completeness })
    .onConflictDoUpdate({
      target: systemSeasonFixtures.fixtureId,
      set: {
        htHome: row.htHome ?? sql`${systemSeasonFixtures.htHome}`,
        htAway: row.htAway ?? sql`${systemSeasonFixtures.htAway}`,
        ftHome: row.ftHome ?? sql`${systemSeasonFixtures.ftHome}`,
        ftAway: row.ftAway ?? sql`${systemSeasonFixtures.ftAway}`,
        status: row.status,
        dataCompleteness: completeness,
        syncedAt: row.syncedAt,
      },
    });
}

export async function replaceSystemSeasonGoals(
  fixtureId: number,
  goals: NewSystemSeasonGoal[]
): Promise<void> {
  const db = await getDb();
  await db
    .delete(systemSeasonGoals)
    .where(eq(systemSeasonGoals.fixtureId, fixtureId));
  if (goals.length) await db.insert(systemSeasonGoals).values(goals);
}

export async function replaceSystemSeasonStats(
  fixtureId: number,
  stats: NewSystemSeasonStat[]
): Promise<void> {
  const db = await getDb();
  await db
    .delete(systemSeasonStats)
    .where(eq(systemSeasonStats.fixtureId, fixtureId));
  if (stats.length) await db.insert(systemSeasonStats).values(stats);
}

export async function replaceSystemSeasonLineups(
  fixtureId: number,
  lineups: NewSystemSeasonLineup[]
): Promise<void> {
  const db = await getDb();
  await db
    .delete(systemSeasonLineups)
    .where(eq(systemSeasonLineups.fixtureId, fixtureId));
  if (lineups.length) await db.insert(systemSeasonLineups).values(lineups);
}

export async function getSystemSeasonFixture(
  fixtureId: number
): Promise<SystemSeasonFixture | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(systemSeasonFixtures)
    .where(eq(systemSeasonFixtures.fixtureId, fixtureId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listFixturesNeedingEnrichment(
  leagueId: number,
  season: number,
  limit: number
): Promise<SystemSeasonFixture[]> {
  const db = await getDb();
  return db
    .select()
    .from(systemSeasonFixtures)
    .where(
      and(
        eq(systemSeasonFixtures.leagueId, leagueId),
        eq(systemSeasonFixtures.season, season),
        inArray(systemSeasonFixtures.dataCompleteness, ["core-only", "partial"])
      )
    )
    .orderBy(asc(systemSeasonFixtures.dateUtc))
    .limit(limit);
}

export async function countSystemSeasonFixtures(
  leagueId: number,
  season: number
): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(systemSeasonFixtures)
    .where(
      and(
        eq(systemSeasonFixtures.leagueId, leagueId),
        eq(systemSeasonFixtures.season, season)
      )
    );
  return rows[0]?.n ?? 0;
}

export async function upsertTeamRates(rows: NewSystemSeasonTeamRate[]): Promise<void> {
  if (!rows.length) return;
  const db = await getDb();
  for (const row of rows) {
    await db
      .insert(systemSeasonTeamRates)
      .values(row)
      .onConflictDoUpdate({
        target: [
          systemSeasonTeamRates.teamId,
          systemSeasonTeamRates.leagueId,
          systemSeasonTeamRates.season,
        ],
        set: {
          teamName: row.teamName,
          nMatches: row.nMatches,
          af1: row.af1,
          af2: row.af2,
          da1: row.da1,
          da2: row.da2,
          avgCornersFor: row.avgCornersFor,
          avgCornersAgainst: row.avgCornersAgainst,
          dataCompleteness: row.dataCompleteness,
          updatedAt: row.updatedAt,
        },
      });
  }
}

export async function getTeamRates(
  teamId: number,
  leagueId: number,
  season: number = SYSTEM_SEASON_YEAR
) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(systemSeasonTeamRates)
    .where(
      and(
        eq(systemSeasonTeamRates.teamId, teamId),
        eq(systemSeasonTeamRates.leagueId, leagueId),
        eq(systemSeasonTeamRates.season, season)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getTeamRatesByName(
  teamName: string,
  leagueId: number,
  season: number = SYSTEM_SEASON_YEAR
) {
  const db = await getDb();
  const key = teamName.trim().toLowerCase();
  const rows = await db
    .select()
    .from(systemSeasonTeamRates)
    .where(
      and(
        eq(systemSeasonTeamRates.leagueId, leagueId),
        eq(systemSeasonTeamRates.season, season),
        sql`lower(${systemSeasonTeamRates.teamName}) = ${key}`
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listTeamFixturesForSeason(
  teamId: number,
  leagueId: number,
  season: number
): Promise<SystemSeasonFixture[]> {
  const db = await getDb();
  return db
    .select()
    .from(systemSeasonFixtures)
    .where(
      and(
        eq(systemSeasonFixtures.leagueId, leagueId),
        eq(systemSeasonFixtures.season, season),
        or(
          eq(systemSeasonFixtures.homeId, teamId),
          eq(systemSeasonFixtures.awayId, teamId)
        ),
        inArray(systemSeasonFixtures.status, ["FT", "AET", "PEN"])
      )
    )
    .orderBy(desc(systemSeasonFixtures.dateUtc));
}

export async function listAllFixturesForLeagueSeason(
  leagueId: number,
  season: number
): Promise<SystemSeasonFixture[]> {
  const db = await getDb();
  return db
    .select()
    .from(systemSeasonFixtures)
    .where(
      and(
        eq(systemSeasonFixtures.leagueId, leagueId),
        eq(systemSeasonFixtures.season, season)
      )
    )
    .orderBy(asc(systemSeasonFixtures.dateUtc));
}

export async function listFixturesInDateWindow(
  leagueId: number,
  season: number,
  from: Date,
  to: Date
): Promise<SystemSeasonFixture[]> {
  const db = await getDb();
  return db
    .select()
    .from(systemSeasonFixtures)
    .where(
      and(
        eq(systemSeasonFixtures.leagueId, leagueId),
        eq(systemSeasonFixtures.season, season),
        gte(systemSeasonFixtures.dateUtc, from),
        lte(systemSeasonFixtures.dateUtc, to)
      )
    );
}

export async function getSyncMeta(leagueId: number) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(systemSeasonSyncMeta)
    .where(eq(systemSeasonSyncMeta.leagueId, leagueId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertSyncMeta(
  leagueId: number,
  patch: Partial<{
    season: number;
    lastRunAt: Date;
    lastError: string | null;
    fixturesSynced: number;
    cursorFixtureId: number | null;
    backfillComplete: number;
  }>
): Promise<void> {
  const db = await getDb();
  const now = patch.lastRunAt ?? new Date();
  await db
    .insert(systemSeasonSyncMeta)
    .values({
      leagueId,
      season: patch.season ?? SYSTEM_SEASON_YEAR,
      lastRunAt: now,
      lastError: patch.lastError ?? null,
      fixturesSynced: patch.fixturesSynced ?? 0,
      cursorFixtureId: patch.cursorFixtureId ?? null,
      backfillComplete: patch.backfillComplete ?? 0,
    })
    .onConflictDoUpdate({
      target: systemSeasonSyncMeta.leagueId,
      set: {
        ...(patch.season != null ? { season: patch.season } : {}),
        lastRunAt: now,
        ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
        ...(patch.fixturesSynced != null
          ? { fixturesSynced: patch.fixturesSynced }
          : {}),
        ...(patch.cursorFixtureId !== undefined
          ? { cursorFixtureId: patch.cursorFixtureId }
          : {}),
        ...(patch.backfillComplete != null
          ? { backfillComplete: patch.backfillComplete }
          : {}),
      },
    });
}

export function fixtureNeedsEnrichment(f: SystemSeasonFixture): boolean {
  return completenessRank(f.dataCompleteness) < completenessRank("full");
}

export async function countSystemSeasonHtForTeam(
  teamName: string,
  leagueId: number,
  season: number = SYSTEM_SEASON_YEAR
): Promise<{ withField: number; total: number }> {
  const db = await getDb();
  const key = teamName.trim().toLowerCase();
  const std = teamName.trim();
  try {
    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        withHt: sql<number>`count(*) filter (where ${systemSeasonFixtures.htHome} is not null and ${systemSeasonFixtures.htAway} is not null)::int`,
      })
      .from(systemSeasonFixtures)
      .where(
        and(
          eq(systemSeasonFixtures.leagueId, leagueId),
          eq(systemSeasonFixtures.season, season),
          isNotNull(systemSeasonFixtures.ftHome),
          isNotNull(systemSeasonFixtures.ftAway),
          inArray(systemSeasonFixtures.status, ["FT", "AET", "PEN"]),
          or(
            eq(systemSeasonFixtures.homeTeam, std),
            eq(systemSeasonFixtures.awayTeam, std),
            sql`lower(${systemSeasonFixtures.homeTeam}) = ${key}`,
            sql`lower(${systemSeasonFixtures.awayTeam}) = ${key}`
          )
        )
      );
    const row = rows[0];
    return { withField: row?.withHt ?? 0, total: row?.total ?? 0 };
  } catch {
    return { withField: 0, total: 0 };
  }
}

export async function countSystemSeasonCornersForTeam(
  teamName: string,
  leagueId: number,
  season: number = SYSTEM_SEASON_YEAR
): Promise<{ withField: number; total: number }> {
  const db = await getDb();
  const key = teamName.trim().toLowerCase();
  const std = teamName.trim();
  try {
    const rows = await db
      .select({
        total: sql<number>`count(distinct ${systemSeasonFixtures.fixtureId})::int`,
        withCorners: sql<number>`count(distinct ${systemSeasonFixtures.fixtureId}) filter (where ${systemSeasonStats.corners} is not null)::int`,
      })
      .from(systemSeasonFixtures)
      .innerJoin(
        systemSeasonStats,
        eq(systemSeasonStats.fixtureId, systemSeasonFixtures.fixtureId)
      )
      .where(
        and(
          eq(systemSeasonFixtures.leagueId, leagueId),
          eq(systemSeasonFixtures.season, season),
          isNotNull(systemSeasonFixtures.ftHome),
          inArray(systemSeasonFixtures.status, ["FT", "AET", "PEN"]),
          or(
            eq(systemSeasonFixtures.homeTeam, std),
            eq(systemSeasonFixtures.awayTeam, std),
            sql`lower(${systemSeasonFixtures.homeTeam}) = ${key}`,
            sql`lower(${systemSeasonFixtures.awayTeam}) = ${key}`
          )
        )
      );
    const row = rows[0];
    return { withField: row?.withCorners ?? 0, total: row?.total ?? 0 };
  } catch {
    return { withField: 0, total: 0 };
  }
}

export async function countSystemSeasonMatchRecords(
  leagueId: number,
  season: number = SYSTEM_SEASON_YEAR
): Promise<{ count: number; dateFrom: string | null; dateTo: string | null }> {
  const db = await getDb();
  try {
    const rows = await db
      .select({
        count: sql<number>`count(*)::int`,
        dateFrom: sql<string | null>`min(${systemSeasonFixtures.dateUtc})::text`,
        dateTo: sql<string | null>`max(${systemSeasonFixtures.dateUtc})::text`,
      })
      .from(systemSeasonFixtures)
      .where(
        and(
          eq(systemSeasonFixtures.leagueId, leagueId),
          eq(systemSeasonFixtures.season, season),
          isNotNull(systemSeasonFixtures.ftHome),
          isNotNull(systemSeasonFixtures.ftAway),
          inArray(systemSeasonFixtures.status, ["FT", "AET", "PEN"])
        )
      );
    const row = rows[0];
    return {
      count: row?.count ?? 0,
      dateFrom: row?.dateFrom?.slice(0, 10) ?? null,
      dateTo: row?.dateTo?.slice(0, 10) ?? null,
    };
  } catch {
    return { count: 0, dateFrom: null, dateTo: null };
  }
}

export async function listSeasonFixturesBefore(
  leagueId: number,
  season: number,
  beforeDate: string
): Promise<SystemSeasonFixture[]> {
  const db = await getDb();
  const cutoff = new Date(`${beforeDate}T23:59:59.999Z`);
  return db
    .select()
    .from(systemSeasonFixtures)
    .where(
      and(
        eq(systemSeasonFixtures.leagueId, leagueId),
        eq(systemSeasonFixtures.season, season),
        lt(systemSeasonFixtures.dateUtc, cutoff),
        inArray(systemSeasonFixtures.status, ["FT", "AET", "PEN"])
      )
    );
}
