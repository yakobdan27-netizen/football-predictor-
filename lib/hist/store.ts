/**
 * Idempotent hist_* upserts. Never writes live_, bet_, match_stats, or pred-log.
 */
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  histFixtures,
  histGoals,
  histJobs,
  histLineups,
  histStats,
  histTeams,
  type HistFixture,
  type HistJob,
  type NewHistFixture,
  type NewHistGoal,
  type NewHistLineup,
  type NewHistStat,
  type NewHistTeam,
} from "@/lib/db/schema";
import { completenessRank, richerCompleteness } from "./map";
import { histJobKeys } from "./seasons";

export async function ensureHistJobs(): Promise<number> {
  const db = await getDb();
  const keys = histJobKeys();
  const now = new Date();
  // Always upsert missing keys (onConflictDoNothing). Never resets done jobs.
  const values = keys.map((key) => ({
    leagueId: key.leagueId,
    season: key.season,
    leagueName: key.leagueName,
    status: "pending" as const,
    cursorFixtureId: null,
    fixturesTotal: 0,
    fixturesImported: 0,
    goalsImported: 0,
    statsImported: 0,
    skipReason: null,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
  }));
  const chunkSize = 10;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);
    await db.insert(histJobs).values(chunk).onConflictDoNothing();
  }
  return keys.length;
}

export async function listActiveHistJobs(): Promise<HistJob[]> {
  const db = await getDb();
  return db
    .select()
    .from(histJobs)
    .where(inArray(histJobs.status, ["pending", "in_progress"]))
    .orderBy(asc(histJobs.leagueId), asc(histJobs.season));
}

export async function getHistJob(
  leagueId: number,
  season: number
): Promise<HistJob | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(histJobs)
    .where(
      and(eq(histJobs.leagueId, leagueId), eq(histJobs.season, season))
    )
    .limit(1);
  return row ?? null;
}

export async function updateHistJob(
  leagueId: number,
  season: number,
  patch: Partial<{
    status: string;
    cursorFixtureId: number | null;
    fixturesTotal: number;
    fixturesImported: number;
    goalsImported: number;
    statsImported: number;
    skipReason: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>
): Promise<void> {
  const db = await getDb();
  await db
    .update(histJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(eq(histJobs.leagueId, leagueId), eq(histJobs.season, season))
    );
}

export async function getHistFixture(
  fixtureId: number
): Promise<HistFixture | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(histFixtures)
    .where(eq(histFixtures.fixtureId, fixtureId))
    .limit(1);
  return row ?? null;
}

export async function listImportedFixtureIds(
  leagueId: number,
  season: number
): Promise<Map<number, string>> {
  const db = await getDb();
  const rows = await db
    .select({
      fixtureId: histFixtures.fixtureId,
      dataCompleteness: histFixtures.dataCompleteness,
    })
    .from(histFixtures)
    .where(
      and(
        eq(histFixtures.leagueId, leagueId),
        eq(histFixtures.season, season)
      )
    );
  return new Map(rows.map((r) => [r.fixtureId, r.dataCompleteness]));
}

export async function upsertHistTeams(teams: NewHistTeam[]): Promise<void> {
  if (!teams.length) return;
  const db = await getDb();
  for (const team of teams) {
    const [existing] = await db
      .select()
      .from(histTeams)
      .where(eq(histTeams.teamId, team.teamId))
      .limit(1);
    if (existing) {
      const first =
        existing.firstSeenSeason != null && team.firstSeenSeason != null
          ? Math.min(existing.firstSeenSeason, team.firstSeenSeason)
          : (existing.firstSeenSeason ?? team.firstSeenSeason ?? null);
      await db
        .update(histTeams)
        .set({
          name: team.name,
          logo: team.logo ?? existing.logo,
          country: team.country ?? existing.country,
          firstSeenSeason: first,
        })
        .where(eq(histTeams.teamId, team.teamId));
    } else {
      await db.insert(histTeams).values(team);
    }
  }
}

export async function upsertHistFixture(
  row: NewHistFixture
): Promise<"inserted" | "updated" | "skipped"> {
  const existing = await getHistFixture(row.fixtureId);
  const incomingCompleteness = row.dataCompleteness ?? "core-only";
  if (existing) {
    if (
      completenessRank(existing.dataCompleteness) >
      completenessRank(incomingCompleteness)
    ) {
      return "skipped";
    }
    const mergedCompleteness = richerCompleteness(
      existing.dataCompleteness,
      incomingCompleteness
    );
    const db = await getDb();
    await db
      .update(histFixtures)
      .set({
        leagueId: row.leagueId,
        season: row.season,
        compType: row.compType ?? existing.compType ?? "league",
        round: row.round ?? existing.round,
        dateUtc: row.dateUtc,
        homeId: row.homeId ?? existing.homeId,
        awayId: row.awayId ?? existing.awayId,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        venue: row.venue ?? existing.venue,
        htHome: row.htHome ?? existing.htHome,
        htAway: row.htAway ?? existing.htAway,
        ftHome: row.ftHome ?? existing.ftHome,
        ftAway: row.ftAway ?? existing.ftAway,
        status: row.status,
        dataCompleteness: mergedCompleteness,
        importedAt: row.importedAt,
      })
      .where(eq(histFixtures.fixtureId, row.fixtureId));
    return "updated";
  }
  const db = await getDb();
  await db.insert(histFixtures).values(row);
  return "inserted";
}

export async function replaceHistGoals(
  fixtureId: number,
  goals: NewHistGoal[]
): Promise<number> {
  const db = await getDb();
  await db.delete(histGoals).where(eq(histGoals.fixtureId, fixtureId));
  if (!goals.length) return 0;
  await db.insert(histGoals).values(goals);
  return goals.length;
}

export async function replaceHistStats(
  fixtureId: number,
  stats: NewHistStat[]
): Promise<number> {
  const db = await getDb();
  await db.delete(histStats).where(eq(histStats.fixtureId, fixtureId));
  if (!stats.length) return 0;
  await db.insert(histStats).values(stats);
  return stats.length;
}

export async function replaceHistLineups(
  fixtureId: number,
  lineups: NewHistLineup[]
): Promise<number> {
  const db = await getDb();
  await db.delete(histLineups).where(eq(histLineups.fixtureId, fixtureId));
  if (!lineups.length) return 0;
  await db.insert(histLineups).values(lineups);
  return lineups.length;
}

export async function hasHistStats(fixtureId: number): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(histStats)
    .where(eq(histStats.fixtureId, fixtureId));
  return (row?.n ?? 0) > 0;
}

export async function hasHistGoals(fixtureId: number): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(histGoals)
    .where(eq(histGoals.fixtureId, fixtureId));
  return (row?.n ?? 0) > 0;
}

export async function hasHistLineups(fixtureId: number): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(histLineups)
    .where(eq(histLineups.fixtureId, fixtureId));
  return (row?.n ?? 0) > 0;
}

export async function histJobsSummary() {
  const db = await getDb();
  const jobs = await db.select().from(histJobs).orderBy(
    asc(histJobs.leagueId),
    asc(histJobs.season)
  );
  const [fx] = await db.select({ n: count() }).from(histFixtures);
  const [goals] = await db.select({ n: count() }).from(histGoals);
  const [stats] = await db.select({ n: count() }).from(histStats);
  const byStatus: Record<string, number> = {};
  for (const j of jobs) {
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
  }
  return {
    jobs,
    byStatus,
    fixtures: fx?.n ?? 0,
    goals: goals?.n ?? 0,
    stats: stats?.n ?? 0,
  };
}

export async function countFixturesForLeagueSeason(
  leagueId: number,
  season: number
): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(histFixtures)
    .where(
      and(
        eq(histFixtures.leagueId, leagueId),
        eq(histFixtures.season, season)
      )
    );
  return row?.n ?? 0;
}
