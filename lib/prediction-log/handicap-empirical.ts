/**
 * Empirical Asian handicap cover rates from finished match scores.
 * Primary probability source for handicap markets; Dixon-Coles grid is fallback only.
 */
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { standardizeTeamName } from "@/lib/data/team-names";
import { getDb, schema } from "@/lib/db";
import { HIST_LEAGUES } from "@/lib/hist/seasons";
import {
  asianHandicapProb,
  asianHandicapResult,
  goalDifference,
  halfTimeScoreGrid,
} from "./handicap";
import type { PredictionBatch } from "./types";

export const HANDICAP_MIN_SAMPLES = 15;

export type HandicapHistRow = {
  ftHome: number;
  ftAway: number;
  htHome?: number | null;
  htAway?: number | null;
  date?: string;
};

export type HandicapEmpiricalResult = {
  prob: number;
  n: number;
  pushRate: number;
  source: "hist" | "insufficient";
};

function normTeam(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

function rowKey(row: HandicapHistRow): string {
  return `${row.date ?? ""}|${row.ftHome}|${row.ftAway}`;
}

/** Merge sample arrays, deduping identical score rows. */
export function mergeHandicapSamples(
  ...arrays: HandicapHistRow[][]
): HandicapHistRow[] {
  const seen = new Set<string>();
  const out: HandicapHistRow[] = [];
  for (const arr of arrays) {
    for (const row of arr) {
      const key = rowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function leagueIdForName(league: string): number | null {
  const norm = league.trim().toLowerCase();
  const hit = HIST_LEAGUES.find((l) => l.name.toLowerCase() === norm);
  return hit?.id ?? null;
}

function batchRowToHist(
  match: PredictionBatch["matches"][number],
  batchDate: string,
  homeTeam: string,
  awayTeam: string,
  mode: "h2h" | "home_venue" | "away_venue",
  ht?: boolean
): HandicapHistRow | null {
  const hg = match.teamStats?.home?.goals;
  const ag = match.teamStats?.away?.goals;
  if (hg == null || ag == null) return null;

  const mHome = normTeam(match.homeTeam);
  const mAway = normTeam(match.awayTeam);
  const targetHome = normTeam(homeTeam);
  const targetAway = normTeam(awayTeam);

  let ftHome = hg;
  let ftAway = ag;

  if (mode === "h2h") {
    if (mHome === targetAway && mAway === targetHome) {
      ftHome = ag;
      ftAway = hg;
    } else if (mHome !== targetHome || mAway !== targetAway) {
      return null;
    }
  } else if (mode === "home_venue") {
    if (mHome !== targetHome) return null;
  } else if (mode === "away_venue") {
    if (mAway !== targetAway) return null;
  }

  let htHome: number | null | undefined;
  let htAway: number | null | undefined;
  if (ht) {
    const hth = match.teamStats?.home?.firstHalfGoals;
    const hta = match.teamStats?.away?.firstHalfGoals;
    if (hth == null || hta == null) return null;
    if (mode === "h2h" && mHome === targetAway && mAway === targetHome) {
      htHome = hta;
      htAway = hth;
    } else {
      htHome = hth;
      htAway = hta;
    }
  }

  return {
    ftHome,
    ftAway,
    htHome,
    htAway,
    date: match.matchDate ?? batchDate,
  };
}

/**
 * Build handicap samples from prediction-log batches (H2H + venue splits).
 */
export function buildHandicapSamplesFromBatches(
  homeTeam: string,
  awayTeam: string,
  league: string,
  batches: PredictionBatch[],
  beforeDate?: string,
  opts?: { ht?: boolean; maxPerBucket?: number }
): HandicapHistRow[] {
  const maxPer = opts?.maxPerBucket ?? 40;
  const h2h: HandicapHistRow[] = [];
  const homeVenue: HandicapHistRow[] = [];
  const awayVenue: HandicapHistRow[] = [];
  const leagueNorm = league.trim().toLowerCase();
  const homeNorm = normTeam(homeTeam);
  const awayNorm = normTeam(awayTeam);

  const sorted = [...batches].sort((a, b) => a.date.localeCompare(b.date));

  for (const batch of sorted) {
    if (beforeDate && batch.date >= beforeDate) continue;
    for (const match of batch.matches) {
      const matchLeague = (match.league ?? batch.league).trim().toLowerCase();
      if (matchLeague !== leagueNorm) continue;

      const mHome = normTeam(match.homeTeam);
      const mAway = normTeam(match.awayTeam);
      const hg = match.teamStats?.home?.goals;
      const ag = match.teamStats?.away?.goals;
      if (hg == null || ag == null) continue;

      const isH2h =
        (mHome === homeNorm && mAway === awayNorm) ||
        (mHome === awayNorm && mAway === homeNorm);
      const isHomeVenue = mHome === homeNorm;
      const isAwayVenue = mAway === awayNorm;

      if (!isH2h && !isHomeVenue && !isAwayVenue) continue;

      if (isH2h && h2h.length < maxPer) {
        const row = batchRowToHist(
          match,
          batch.date,
          homeTeam,
          awayTeam,
          "h2h",
          opts?.ht
        );
        if (row) h2h.push(row);
      } else if (isHomeVenue && homeVenue.length < maxPer) {
        const row = batchRowToHist(
          match,
          batch.date,
          homeTeam,
          awayTeam,
          "home_venue",
          opts?.ht
        );
        if (row) homeVenue.push(row);
      } else if (isAwayVenue && awayVenue.length < maxPer) {
        const row = batchRowToHist(
          match,
          batch.date,
          homeTeam,
          awayTeam,
          "away_venue",
          opts?.ht
        );
        if (row) awayVenue.push(row);
      }
    }
  }

  return mergeHandicapSamples(h2h, homeVenue, awayVenue);
}

function mapDbFixture(
  row: {
    ftHome: number;
    ftAway: number;
    htHome: number | null;
    htAway: number | null;
    dateUtc: Date;
    homeTeam: string;
    awayTeam: string;
  },
  homeTeam: string,
  awayTeam: string,
  ht?: boolean
): HandicapHistRow | null {
  const homeNorm = normTeam(row.homeTeam);
  const awayNorm = normTeam(row.awayTeam);
  const targetHome = normTeam(homeTeam);
  const targetAway = normTeam(awayTeam);

  let ftHome = row.ftHome;
  let ftAway = row.ftAway;
  if (homeNorm === targetAway && awayNorm === targetHome) {
    ftHome = row.ftAway;
    ftAway = row.ftHome;
  } else if (homeNorm !== targetHome || awayNorm !== targetAway) {
    return null;
  }

  let htHome = row.htHome;
  let htAway = row.htAway;
  if (ht) {
    if (htHome == null || htAway == null) return null;
    if (homeNorm === targetAway && awayNorm === targetHome) {
      htHome = row.htAway;
      htAway = row.htHome;
    }
  }

  return {
    ftHome,
    ftAway,
    htHome,
    htAway,
    date: row.dateUtc.toISOString(),
  };
}

/** Load finished hist_fixtures for H2H + venue samples. */
export async function fetchHandicapHistSamples(opts: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  beforeDate?: string;
  ht?: boolean;
  limit?: number;
}): Promise<HandicapHistRow[]> {
  const leagueId = leagueIdForName(opts.league);
  if (leagueId == null) return [];

  try {
    const db = await getDb();
    const homeNorm = normTeam(opts.homeTeam);
    const awayNorm = normTeam(opts.awayTeam);
    const limit = opts.limit ?? 120;

    const conditions = [
      eq(schema.histFixtures.leagueId, leagueId),
      isNotNull(schema.histFixtures.ftHome),
      isNotNull(schema.histFixtures.ftAway),
      eq(schema.histFixtures.status, "FT"),
      or(
        and(
          sql`lower(${schema.histFixtures.homeTeam}) = ${homeNorm}`,
          sql`lower(${schema.histFixtures.awayTeam}) = ${awayNorm}`
        ),
        and(
          sql`lower(${schema.histFixtures.homeTeam}) = ${awayNorm}`,
          sql`lower(${schema.histFixtures.awayTeam}) = ${homeNorm}`
        ),
        sql`lower(${schema.histFixtures.homeTeam}) = ${homeNorm}`,
        sql`lower(${schema.histFixtures.awayTeam}) = ${awayNorm}`
      ),
    ];

    if (opts.beforeDate) {
      conditions.push(lt(schema.histFixtures.dateUtc, new Date(opts.beforeDate)));
    }

    const fixtures = await db
      .select({
        ftHome: schema.histFixtures.ftHome,
        ftAway: schema.histFixtures.ftAway,
        htHome: schema.histFixtures.htHome,
        htAway: schema.histFixtures.htAway,
        dateUtc: schema.histFixtures.dateUtc,
        homeTeam: schema.histFixtures.homeTeam,
        awayTeam: schema.histFixtures.awayTeam,
      })
      .from(schema.histFixtures)
      .where(and(...conditions))
      .orderBy(sql`${schema.histFixtures.dateUtc} DESC`)
      .limit(limit);

    const rows: HandicapHistRow[] = [];
    for (const f of fixtures) {
      if (f.ftHome == null || f.ftAway == null) continue;
      const mapped = mapDbFixture(
        { ...f, ftHome: f.ftHome, ftAway: f.ftAway },
        opts.homeTeam,
        opts.awayTeam,
        opts.ht
      );
      if (mapped) rows.push(mapped);
    }
    return mergeHandicapSamples(rows);
  } catch {
    return [];
  }
}

function diffFromRow(row: HandicapHistRow, ht?: boolean): number | null {
  if (ht) {
    if (row.htHome == null || row.htAway == null) return null;
    return goalDifference(row.htHome, row.htAway);
  }
  return goalDifference(row.ftHome, row.ftAway);
}

/**
 * Fraction of finished rows where the side covers (pushes excluded from denominator).
 */
export function empiricalAsianCoverRate(
  rows: HandicapHistRow[],
  homeLine: number,
  side: "home" | "away",
  opts?: { ht?: boolean }
): { prob: number; n: number; pushRate: number } {
  let covers = 0;
  let decisive = 0;
  let pushes = 0;

  for (const row of rows) {
    const diff = diffFromRow(row, opts?.ht);
    if (diff == null) continue;
    const result = asianHandicapResult(diff, homeLine);
    if (result === "push") {
      pushes += 1;
      continue;
    }
    decisive += 1;
    if (result === side) covers += 1;
  }

  const n = decisive;
  const pushRate = rows.length > 0 ? pushes / rows.length : 0;
  return {
    prob: n > 0 ? covers / n : 0,
    n,
    pushRate,
  };
}

export function handicapEmpiricalProb(input: {
  rows: HandicapHistRow[];
  homeLine: number;
  side: "home" | "away";
  minSamples?: number;
  ht?: boolean;
}): HandicapEmpiricalResult {
  const min = input.minSamples ?? HANDICAP_MIN_SAMPLES;
  const { prob, n, pushRate } = empiricalAsianCoverRate(
    input.rows,
    input.homeLine,
    input.side,
    { ht: input.ht }
  );
  if (n < min) {
    return { prob, n, pushRate, source: "insufficient" };
  }
  return { prob, n, pushRate, source: "hist" };
}

/** Resolve empirical prob with Dixon-Coles grid fallback. */
export function resolveHandicapProbability(input: {
  rows: HandicapHistRow[];
  homeLine: number;
  side: "home" | "away";
  grid: number[][];
  ht?: boolean;
  lambdaHome?: number;
  lambdaAway?: number;
  minSamples?: number;
}): {
  prob: number;
  n: number;
  pushRate: number;
  source: "hist" | "estimated_fallback" | "insufficient";
} {
  const emp = handicapEmpiricalProb({
    rows: input.rows,
    homeLine: input.homeLine,
    side: input.side,
    minSamples: input.minSamples,
    ht: input.ht,
  });

  if (emp.source === "hist") {
    return { ...emp, source: "hist" };
  }

  const grid =
    input.ht && input.lambdaHome != null && input.lambdaAway != null
      ? halfTimeScoreGrid(input.lambdaHome, input.lambdaAway)
      : input.grid;
  const prob = asianHandicapProb(grid, input.homeLine, input.side);
  return {
    prob,
    n: emp.n,
    pushRate: emp.pushRate,
    source: emp.n > 0 ? "estimated_fallback" : "insufficient",
  };
}
