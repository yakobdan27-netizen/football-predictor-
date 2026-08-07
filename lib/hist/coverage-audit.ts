/**
 * Read-only hist_* coverage audit for all HIST_LEAGUES × 11 completed seasons.
 * Never calls API-Football. Uses batched SQL for speed.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  histFixtures,
  histGoals,
  histJobs,
  histLineups,
  histStats,
} from "@/lib/db/schema";
import { HIST_LEAGUES, histSeasonYears } from "./seasons";

export type BucketCompleteness =
  | "full"
  | "partial"
  | "core-only"
  | "missing";

export type HistCoverageBucket = {
  leagueId: number;
  leagueName: string;
  season: number;
  compType: "league" | "cup";
  expected_fixtures: number;
  stored_fixtures: number;
  with_ht_score: number;
  with_goal_timings: number;
  with_match_stats: number;
  with_corners: number;
  with_lineups: number;
  completeness: BucketCompleteness;
};

export type HistCoverageReport = {
  seasons: number[];
  buckets: HistCoverageBucket[];
  summary: {
    full: number;
    partial: number;
    coreOnly: number;
    missing: number;
    total: number;
  };
  /** Per-competition stored fixture totals (all seasons in window). */
  perCompetition: Array<{
    leagueId: number;
    leagueName: string;
    compType: "league" | "cup";
    stored: number;
    withCorners: number;
    withHt: number;
  }>;
};

function rollupCompleteness(b: {
  stored: number;
  expected: number;
  withHt: number;
  withGoals: number;
  withStats: number;
}): BucketCompleteness {
  if (b.stored <= 0) return "missing";
  const htShare = b.withHt / b.stored;
  const goalShare = b.withGoals / b.stored;
  const statsShare = b.withStats / b.stored;
  const inventoryOk =
    b.expected <= 0 || b.stored / Math.max(1, b.expected) >= 0.9;
  if (
    inventoryOk &&
    htShare >= 0.9 &&
    goalShare >= 0.85 &&
    statsShare >= 0.85
  ) {
    return "full";
  }
  if (goalShare < 0.25 && statsShare < 0.25) return "core-only";
  return "partial";
}

export async function auditHistCoverage(opts?: {
  today?: Date;
}): Promise<HistCoverageReport> {
  const seasons = histSeasonYears({
    today: opts?.today,
    includeCurrent: false,
  });
  const leagueIds = HIST_LEAGUES.map((l) => l.id);
  const leagueById = new Map(HIST_LEAGUES.map((l) => [l.id, l] as const));
  const db = await getDb();

  const jobs = await db
    .select({
      leagueId: histJobs.leagueId,
      season: histJobs.season,
      fixturesTotal: histJobs.fixturesTotal,
    })
    .from(histJobs)
    .where(
      and(
        inArray(histJobs.leagueId, leagueIds),
        inArray(histJobs.season, seasons)
      )
    );

  const fxRows = await db
    .select({
      leagueId: histFixtures.leagueId,
      season: histFixtures.season,
      stored: sql<number>`count(*)::int`,
      withHt: sql<number>`count(*) filter (where ${histFixtures.htHome} is not null and ${histFixtures.htAway} is not null)::int`,
    })
    .from(histFixtures)
    .where(
      and(
        inArray(histFixtures.leagueId, leagueIds),
        inArray(histFixtures.season, seasons)
      )
    )
    .groupBy(histFixtures.leagueId, histFixtures.season);

  const goalRows = await db
    .select({
      leagueId: histFixtures.leagueId,
      season: histFixtures.season,
      n: sql<number>`count(distinct ${histGoals.fixtureId})::int`,
    })
    .from(histGoals)
    .innerJoin(histFixtures, eq(histGoals.fixtureId, histFixtures.fixtureId))
    .where(
      and(
        inArray(histFixtures.leagueId, leagueIds),
        inArray(histFixtures.season, seasons)
      )
    )
    .groupBy(histFixtures.leagueId, histFixtures.season);

  const statsRows = await db
    .select({
      leagueId: histFixtures.leagueId,
      season: histFixtures.season,
      n: sql<number>`count(distinct ${histStats.fixtureId})::int`,
      withCorners: sql<number>`count(distinct ${histStats.fixtureId}) filter (where ${histStats.corners} is not null)::int`,
    })
    .from(histStats)
    .innerJoin(histFixtures, eq(histStats.fixtureId, histFixtures.fixtureId))
    .where(
      and(
        inArray(histFixtures.leagueId, leagueIds),
        inArray(histFixtures.season, seasons)
      )
    )
    .groupBy(histFixtures.leagueId, histFixtures.season);

  const lineupRows = await db
    .select({
      leagueId: histFixtures.leagueId,
      season: histFixtures.season,
      n: sql<number>`count(distinct ${histLineups.fixtureId})::int`,
    })
    .from(histLineups)
    .innerJoin(histFixtures, eq(histLineups.fixtureId, histFixtures.fixtureId))
    .where(
      and(
        inArray(histFixtures.leagueId, leagueIds),
        inArray(histFixtures.season, seasons)
      )
    )
    .groupBy(histFixtures.leagueId, histFixtures.season);

  const key = (leagueId: number, season: number) => `${leagueId}:${season}`;
  const jobMap = new Map(
    jobs.map((j) => [key(j.leagueId, j.season), j.fixturesTotal] as const)
  );
  const fxMap = new Map(
    fxRows.map((r) => [key(r.leagueId, r.season), r] as const)
  );
  const goalMap = new Map(
    goalRows.map((r) => [key(r.leagueId, r.season), Number(r.n)] as const)
  );
  const statsMap = new Map(
    statsRows.map((r) => [key(r.leagueId, r.season), r] as const)
  );
  const lineupMap = new Map(
    lineupRows.map((r) => [key(r.leagueId, r.season), Number(r.n)] as const)
  );

  const buckets: HistCoverageBucket[] = [];
  for (const league of HIST_LEAGUES) {
    for (const season of seasons) {
      const k = key(league.id, season);
      const fx = fxMap.get(k);
      const stored = Number(fx?.stored ?? 0);
      const withHt = Number(fx?.withHt ?? 0);
      const withGoals = goalMap.get(k) ?? 0;
      const st = statsMap.get(k);
      const withStats = Number(st?.n ?? 0);
      const withCorners = Number(st?.withCorners ?? 0);
      const withLineups = lineupMap.get(k) ?? 0;
      const jobTotal = Number(jobMap.get(k) ?? 0);
      const expected = jobTotal > 0 ? jobTotal : stored;
      const completeness = rollupCompleteness({
        stored,
        expected,
        withHt,
        withGoals,
        withStats,
      });
      buckets.push({
        leagueId: league.id,
        leagueName: leagueById.get(league.id)?.name ?? league.name,
        season,
        compType: league.type,
        expected_fixtures: expected,
        stored_fixtures: stored,
        with_ht_score: withHt,
        with_goal_timings: withGoals,
        with_match_stats: withStats,
        with_corners: withCorners,
        with_lineups: withLineups,
        completeness,
      });
    }
  }

  const perCompetition = HIST_LEAGUES.map((league) => {
    const leagueBuckets = buckets.filter((b) => b.leagueId === league.id);
    return {
      leagueId: league.id,
      leagueName: league.name,
      compType: league.type as "league" | "cup",
      stored: leagueBuckets.reduce((a, b) => a + b.stored_fixtures, 0),
      withCorners: leagueBuckets.reduce((a, b) => a + b.with_corners, 0),
      withHt: leagueBuckets.reduce((a, b) => a + b.with_ht_score, 0),
    };
  });

  const summary = {
    full: buckets.filter((b) => b.completeness === "full").length,
    partial: buckets.filter((b) => b.completeness === "partial").length,
    coreOnly: buckets.filter((b) => b.completeness === "core-only").length,
    missing: buckets.filter((b) => b.completeness === "missing").length,
    total: buckets.length,
  };

  return { seasons, buckets, summary, perCompetition };
}

export function formatCoverageTable(report: HistCoverageReport): string {
  const lines: string[] = [];
  lines.push(
    "league\tcomp\tseason\texpected\tstored\tht\tgoals\tstats\tcorners\tlineups\tcompleteness"
  );
  for (const b of report.buckets) {
    lines.push(
      [
        b.leagueName,
        b.compType,
        b.season,
        b.expected_fixtures,
        b.stored_fixtures,
        b.with_ht_score,
        b.with_goal_timings,
        b.with_match_stats,
        b.with_corners,
        b.with_lineups,
        b.completeness,
      ].join("\t")
    );
  }
  lines.push("");
  lines.push("PER COMPETITION (completed window):");
  for (const c of report.perCompetition) {
    lines.push(
      `${c.leagueName}\t${c.compType}\tfixtures=${c.stored}\tht=${c.withHt}\tcorners=${c.withCorners}`
    );
  }
  const s = report.summary;
  lines.push(
    `SUMMARY: ${s.full} of ${s.total} buckets full, ${s.partial} partial, ${s.coreOnly} core-only, ${s.missing} missing`
  );
  return lines.join("\n");
}

/** True if any competition has zero fixtures across the completed window. */
export function hasEmptyCompetition(report: HistCoverageReport): boolean {
  return report.perCompetition.some((c) => c.stored === 0);
}

/** Gap queue: missing → core-only → partial. Skip full. */
export function gapQueueFromCoverage(
  report: HistCoverageReport
): HistCoverageBucket[] {
  const rank = (c: BucketCompleteness): number => {
    if (c === "missing") return 0;
    if (c === "core-only") return 1;
    if (c === "partial") return 2;
    return 9;
  };
  return report.buckets
    .filter((b) => b.completeness !== "full")
    .sort((a, b) => {
      const r = rank(a.completeness) - rank(b.completeness);
      if (r !== 0) return r;
      if (a.leagueId !== b.leagueId) return a.leagueId - b.leagueId;
      return a.season - b.season;
    });
}
