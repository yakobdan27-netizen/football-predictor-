/**
 * HT and corners field coverage for CFE / MSAM eligibility.
 * 60% prior API (hist_*, core_fixture) · 40% system_season_* when blend flag on.
 * Coverage is metadata only — never blends probabilities.
 */
import { and, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { standardizeTeamName } from "@/lib/data/team-names";
import { getDb } from "@/lib/db";
import {
  coreFixture,
  coreFixtureStatistic,
  histFixtures,
  histStats,
} from "@/lib/db/schema";
import { apiLeagueId } from "@/lib/football-api/leagues";
import { histWindowMinSeason } from "@/lib/hist/seasons";
import { isSystemSeasonBlendEnabled } from "@/lib/system-season/feature-flags";
import {
  countSystemSeasonCornersForTeam,
  countSystemSeasonHtForTeam,
} from "@/lib/system-season/store";
import {
  loadClubCornersRates,
  type ClubCornersRates,
} from "./corners-model";
import type { ClubHalfAttackDefence } from "./hsh-half-rates";
import { matchLeague } from "./match-league";
import type { LogMatch, PredictionBatch } from "./types";

export const TARGET_API_WEIGHT = 0.6;
export const TARGET_SYSTEM_WEIGHT = 0.4;

export type SideCoverageBreakdown = {
  systemWith: number;
  systemTotal: number;
  apiWith: number;
  apiTotal: number;
  share: number | null;
};

export type CoverageBreakdown = {
  pct: number | null;
  apiRecords: number;
  systemRecords: number;
  effectiveApiWeight: number;
  effectiveSystemWeight: number;
  home: SideCoverageBreakdown;
  away: SideCoverageBreakdown;
};

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function effectiveWeights(qApi: number, qSystem: number): {
  wApi: number;
  wSystem: number;
} {
  const num = TARGET_API_WEIGHT * qApi + TARGET_SYSTEM_WEIGHT * qSystem;
  if (num <= 0) {
    if (qApi > 0) return { wApi: 1, wSystem: 0 };
    if (qSystem > 0) return { wApi: 0, wSystem: 1 };
    return { wApi: 0, wSystem: 0 };
  }
  return {
    wApi: (TARGET_API_WEIGHT * qApi) / num,
    wSystem: (TARGET_SYSTEM_WEIGHT * qSystem) / num,
  };
}

function sideShare(
  systemWith: number,
  systemTotal: number,
  apiWith: number,
  apiTotal: number
): number | null {
  if (systemTotal <= 0 && apiTotal <= 0) return null;

  const qApi = clamp01(apiTotal / 20);
  const qSystem = clamp01(systemTotal / 20);
  const { wApi, wSystem } = effectiveWeights(qApi, qSystem);

  const apiShare = apiTotal > 0 ? apiWith / apiTotal : 0;
  const systemShare = systemTotal > 0 ? systemWith / systemTotal : 0;

  if (apiTotal <= 0) return systemShare;
  if (systemTotal <= 0) return apiShare;

  return wApi * apiShare + wSystem * systemShare;
}

function hasHtMatch(match: LogMatch, venue: "home" | "away"): boolean {
  const ts = match.teamStats;
  if (!ts) return false;
  const own = venue === "home" ? ts.home : ts.away;
  const opp = venue === "home" ? ts.away : ts.home;
  return (
    own?.firstHalfGoals != null &&
    opp?.firstHalfGoals != null &&
    own?.goals != null &&
    opp?.goals != null &&
    Number.isFinite(own.firstHalfGoals) &&
    Number.isFinite(opp.firstHalfGoals)
  );
}

function hasFtMatch(match: LogMatch, venue: "home" | "away"): boolean {
  const ts = match.teamStats;
  if (!ts) return false;
  const own = venue === "home" ? ts.home : ts.away;
  const opp = venue === "home" ? ts.away : ts.home;
  return (
    own?.goals != null &&
    opp?.goals != null &&
    Number.isFinite(own.goals) &&
    Number.isFinite(opp.goals)
  );
}

function hasCornersMatch(match: LogMatch, venue: "home" | "away"): boolean {
  const ts = match.teamStats;
  if (!ts) return false;
  const own = venue === "home" ? ts.home : ts.away;
  const opp = venue === "home" ? ts.away : ts.home;
  return (
    own?.corners != null &&
    opp?.corners != null &&
    Number.isFinite(own.corners) &&
    Number.isFinite(opp.corners)
  );
}

export function countTeamBatchFieldCoverage(
  batches: PredictionBatch[],
  team: string,
  league: string,
  kind: "ht" | "corners",
  opts?: { beforeDate?: string }
): { withField: number; total: number } {
  const key = teamKey(team);
  let withField = 0;
  let total = 0;

  for (const batch of batches) {
    for (const match of batch.matches) {
      const matchDate = match.matchDate ?? batch.date;
      if (opts?.beforeDate && matchDate >= opts.beforeDate) continue;
      if (matchLeague(match, batch.league) !== league) continue;
      const venue =
        teamKey(match.homeTeam) === key
          ? "home"
          : teamKey(match.awayTeam) === key
            ? "away"
            : null;
      if (!venue) continue;
      if (!hasFtMatch(match, venue)) continue;
      total += 1;
      const ok = kind === "ht" ? hasHtMatch(match, venue) : hasCornersMatch(match, venue);
      if (ok) withField += 1;
    }
  }

  return { withField, total };
}

function syncApiHtCounts(rates: ClubHalfAttackDefence): {
  withField: number;
  total: number;
} {
  const n = rates.apiSeasonCurrentN ?? 0;
  if (n <= 0) return { withField: 0, total: 0 };
  return { withField: n, total: n };
}

function syncApiCornersCounts(rates: ClubCornersRates): {
  withField: number;
  total: number;
} {
  const live = rates.liveMatches ?? 0;
  const seed = Math.max(0, rates.nMatches - live);
  const withField = live + (rates.seedOnly ? 0 : Math.min(seed, rates.nMatches));
  const total = rates.nMatches;
  if (total <= 0) return { withField: 0, total: 0 };
  return { withField: Math.min(withField, total), total };
}

function buildCoverageBreakdown(
  homeSystem: { withField: number; total: number },
  awaySystem: { withField: number; total: number },
  homeApi: { withField: number; total: number },
  awayApi: { withField: number; total: number }
): CoverageBreakdown {
  const homeShare = sideShare(
    homeSystem.withField,
    homeSystem.total,
    homeApi.withField,
    homeApi.total
  );
  const awayShare = sideShare(
    awaySystem.withField,
    awaySystem.total,
    awayApi.withField,
    awayApi.total
  );

  const apiRecords = homeApi.withField + awayApi.withField;
  const systemRecords = homeSystem.withField + awaySystem.withField;
  const qApi = clamp01((homeApi.total + awayApi.total) / 30);
  const qSystem = clamp01((homeSystem.total + awaySystem.total) / 30);
  const weights = effectiveWeights(qApi, qSystem);

  let pct: number | null = null;
  if (homeShare != null && awayShare != null) {
    pct = Math.round(Math.min(homeShare, awayShare) * 1000) / 10;
  } else if (homeShare != null) {
    pct = Math.round(homeShare * 1000) / 10;
  } else if (awayShare != null) {
    pct = Math.round(awayShare * 1000) / 10;
  }

  return {
    pct,
    apiRecords,
    systemRecords,
    effectiveApiWeight: weights.wApi,
    effectiveSystemWeight: weights.wSystem,
    home: {
      systemWith: homeSystem.withField,
      systemTotal: homeSystem.total,
      apiWith: homeApi.withField,
      apiTotal: homeApi.total,
      share: homeShare,
    },
    away: {
      systemWith: awaySystem.withField,
      systemTotal: awaySystem.total,
      apiWith: awayApi.withField,
      apiTotal: awayApi.total,
      share: awayShare,
    },
  };
}

export type HtCoverageInput = {
  homeTeam: string;
  awayTeam: string;
  league: string;
  batches: PredictionBatch[];
  beforeDate?: string;
  homeRates: ClubHalfAttackDefence;
  awayRates: ClubHalfAttackDefence;
  histHome?: { withField: number; total: number };
  histAway?: { withField: number; total: number };
  coreHome?: { withField: number; total: number };
  coreAway?: { withField: number; total: number };
  /** 40% side from system_season_* (when blend flag on). */
  systemSeasonHome?: { withField: number; total: number };
  systemSeasonAway?: { withField: number; total: number };
  /** Skip Match Centre nested counts on the 60% API side. */
  priorApiOnly?: boolean;
};

export function computeHtCoverageSync(input: HtCoverageInput): CoverageBreakdown {
  const useSystemSeason =
    input.priorApiOnly === true ||
    (input.systemSeasonHome != null && input.systemSeasonAway != null);

  const homeSystem = useSystemSeason
    ? (input.systemSeasonHome ?? { withField: 0, total: 0 })
    : countTeamBatchFieldCoverage(
        input.batches,
        input.homeTeam,
        input.league,
        "ht",
        { beforeDate: input.beforeDate }
      );
  const awaySystem = useSystemSeason
    ? (input.systemSeasonAway ?? { withField: 0, total: 0 })
    : countTeamBatchFieldCoverage(
        input.batches,
        input.awayTeam,
        input.league,
        "ht",
        { beforeDate: input.beforeDate }
      );

  const homeApiMc = input.priorApiOnly
    ? { withField: 0, total: 0 }
    : syncApiHtCounts(input.homeRates);
  const awayApiMc = input.priorApiOnly
    ? { withField: 0, total: 0 }
    : syncApiHtCounts(input.awayRates);

  const homeApi = mergeApiCounts(homeApiMc, input.histHome, input.coreHome);
  const awayApi = mergeApiCounts(awayApiMc, input.histAway, input.coreAway);

  return buildCoverageBreakdown(homeSystem, awaySystem, homeApi, awayApi);
}

function mergeApiCounts(
  mc: { withField: number; total: number },
  hist?: { withField: number; total: number },
  core?: { withField: number; total: number }
): { withField: number; total: number } {
  let withField = mc.withField + (hist?.withField ?? 0) + (core?.withField ?? 0);
  let total = mc.total + (hist?.total ?? 0) + (core?.total ?? 0);
  if (total <= 0 && mc.total <= 0) {
    return { withField: 0, total: 0 };
  }
  return { withField, total };
}

export type CornersCoverageInput = {
  homeTeam: string;
  awayTeam: string;
  league: string;
  batches: PredictionBatch[];
  beforeDate?: string;
  homeCorners: ClubCornersRates;
  awayCorners: ClubCornersRates;
  histHome?: { withField: number; total: number };
  histAway?: { withField: number; total: number };
  coreHome?: { withField: number; total: number };
  coreAway?: { withField: number; total: number };
  systemSeasonHome?: { withField: number; total: number };
  systemSeasonAway?: { withField: number; total: number };
  priorApiOnly?: boolean;
};

export function computeCornersCoverageSync(
  input: CornersCoverageInput
): CoverageBreakdown {
  const useSystemSeason =
    input.priorApiOnly === true ||
    (input.systemSeasonHome != null && input.systemSeasonAway != null);

  const homeSystem = useSystemSeason
    ? (input.systemSeasonHome ?? { withField: 0, total: 0 })
    : countTeamBatchFieldCoverage(
        input.batches,
        input.homeTeam,
        input.league,
        "corners",
        { beforeDate: input.beforeDate }
      );
  const awaySystem = useSystemSeason
    ? (input.systemSeasonAway ?? { withField: 0, total: 0 })
    : countTeamBatchFieldCoverage(
        input.batches,
        input.awayTeam,
        input.league,
        "corners",
        { beforeDate: input.beforeDate }
      );

  const homeApiMc = input.priorApiOnly
    ? { withField: 0, total: 0 }
    : syncApiCornersCounts(input.homeCorners);
  const awayApiMc = input.priorApiOnly
    ? { withField: 0, total: 0 }
    : syncApiCornersCounts(input.awayCorners);

  const homeApi = mergeApiCounts(homeApiMc, input.histHome, input.coreHome);
  const awayApi = mergeApiCounts(awayApiMc, input.histAway, input.coreAway);

  return buildCoverageBreakdown(homeSystem, awaySystem, homeApi, awayApi);
}

async function countHistHtForTeam(
  team: string,
  league: string
): Promise<{ withField: number; total: number }> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) return { withField: 0, total: 0 };

  try {
    const db = await getDb();
    const key = teamKey(team);
    const std = standardizeTeamName(team);
    const minSeason = histWindowMinSeason();

    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        withHt: sql<number>`count(*) filter (where ${histFixtures.htHome} is not null and ${histFixtures.htAway} is not null)::int`,
      })
      .from(histFixtures)
      .where(
        and(
          eq(histFixtures.leagueId, leagueId),
          eq(histFixtures.compType, "league"),
          gte(histFixtures.season, minSeason),
          isNotNull(histFixtures.ftHome),
          isNotNull(histFixtures.ftAway),
          or(
            eq(histFixtures.homeTeam, std),
            eq(histFixtures.awayTeam, std),
            sql`lower(${histFixtures.homeTeam}) = ${key}`,
            sql`lower(${histFixtures.awayTeam}) = ${key}`
          )
        )
      );

    const row = rows[0];
    return {
      withField: row?.withHt ?? 0,
      total: row?.total ?? 0,
    };
  } catch {
    return { withField: 0, total: 0 };
  }
}

async function countHistCornersForTeam(
  team: string,
  league: string
): Promise<{ withField: number; total: number }> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) return { withField: 0, total: 0 };

  try {
    const db = await getDb();
    const key = teamKey(team);
    const std = standardizeTeamName(team);
    const minSeason = histWindowMinSeason();

    const rows = await db
      .select({
        total: sql<number>`count(distinct ${histFixtures.fixtureId})::int`,
        withCorners: sql<number>`count(distinct ${histFixtures.fixtureId}) filter (where ${histStats.corners} is not null)::int`,
      })
      .from(histFixtures)
      .innerJoin(histStats, eq(histStats.fixtureId, histFixtures.fixtureId))
      .where(
        and(
          eq(histFixtures.leagueId, leagueId),
          eq(histFixtures.compType, "league"),
          gte(histFixtures.season, minSeason),
          isNotNull(histFixtures.ftHome),
          or(
            eq(histFixtures.homeTeam, std),
            eq(histFixtures.awayTeam, std),
            sql`lower(${histFixtures.homeTeam}) = ${key}`,
            sql`lower(${histFixtures.awayTeam}) = ${key}`
          )
        )
      );

    const row = rows[0];
    return {
      withField: row?.withCorners ?? 0,
      total: row?.total ?? 0,
    };
  } catch {
    return { withField: 0, total: 0 };
  }
}

async function countCoreHtForTeam(
  team: string,
  league: string
): Promise<{ withField: number; total: number }> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) return { withField: 0, total: 0 };

  try {
    const db = await getDb();
    const key = teamKey(team);
    const std = standardizeTeamName(team);

    const rows = await db
      .select({
        total: sql<number>`count(*)::int`,
        withHt: sql<number>`count(*) filter (where ${coreFixture.htHome} is not null and ${coreFixture.htAway} is not null)::int`,
      })
      .from(coreFixture)
      .where(
        and(
          eq(coreFixture.competitionId, leagueId),
          isNotNull(coreFixture.ftHome),
          or(
            eq(coreFixture.homeTeamName, std),
            eq(coreFixture.awayTeamName, std),
            sql`lower(${coreFixture.homeTeamName}) = ${key}`,
            sql`lower(${coreFixture.awayTeamName}) = ${key}`
          )
        )
      );

    const row = rows[0];
    return {
      withField: row?.withHt ?? 0,
      total: row?.total ?? 0,
    };
  } catch {
    return { withField: 0, total: 0 };
  }
}

async function countCoreCornersForTeam(
  team: string,
  league: string
): Promise<{ withField: number; total: number }> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) return { withField: 0, total: 0 };

  try {
    const db = await getDb();
    const key = teamKey(team);
    const std = standardizeTeamName(team);

    const rows = await db
      .select({
        total: sql<number>`count(distinct ${coreFixture.id})::int`,
        withCorners: sql<number>`count(distinct ${coreFixture.id}) filter (where ${coreFixtureStatistic.statValue} is not null)::int`,
      })
      .from(coreFixture)
      .innerJoin(
        coreFixtureStatistic,
        eq(coreFixtureStatistic.fixtureId, coreFixture.id)
      )
      .where(
        and(
          eq(coreFixture.competitionId, leagueId),
          eq(coreFixtureStatistic.statKey, "corners"),
          isNotNull(coreFixture.ftHome),
          or(
            eq(coreFixture.homeTeamName, std),
            eq(coreFixture.awayTeamName, std),
            sql`lower(${coreFixture.homeTeamName}) = ${key}`,
            sql`lower(${coreFixture.awayTeamName}) = ${key}`
          )
        )
      );

    const row = rows[0];
    return {
      withField: row?.withCorners ?? 0,
      total: row?.total ?? 0,
    };
  } catch {
    return { withField: 0, total: 0 };
  }
}

export async function computeHtCoverageAsync(
  input: HtCoverageInput
): Promise<CoverageBreakdown> {
  const priorApiOnly = isSystemSeasonBlendEnabled();
  const leagueId = apiLeagueId(input.league);

  const fetches: [
    Promise<{ withField: number; total: number }>,
    Promise<{ withField: number; total: number }>,
    Promise<{ withField: number; total: number }>,
    Promise<{ withField: number; total: number }>,
    Promise<{ withField: number; total: number }> | null,
    Promise<{ withField: number; total: number }> | null,
  ] = [
    countHistHtForTeam(input.homeTeam, input.league),
    countHistHtForTeam(input.awayTeam, input.league),
    countCoreHtForTeam(input.homeTeam, input.league),
    countCoreHtForTeam(input.awayTeam, input.league),
    priorApiOnly && leagueId != null
      ? countSystemSeasonHtForTeam(input.homeTeam, leagueId)
      : null,
    priorApiOnly && leagueId != null
      ? countSystemSeasonHtForTeam(input.awayTeam, leagueId)
      : null,
  ];

  const [histHome, histAway, coreHome, coreAway, sysHome, sysAway] =
    await Promise.all([
      fetches[0],
      fetches[1],
      fetches[2],
      fetches[3],
      fetches[4] ?? Promise.resolve(undefined),
      fetches[5] ?? Promise.resolve(undefined),
    ]);

  return computeHtCoverageSync({
    ...input,
    histHome,
    histAway,
    coreHome,
    coreAway,
    priorApiOnly,
    ...(priorApiOnly
      ? {
          systemSeasonHome: sysHome ?? { withField: 0, total: 0 },
          systemSeasonAway: sysAway ?? { withField: 0, total: 0 },
        }
      : {}),
  });
}

export async function computeCornersCoverageAsync(
  input: CornersCoverageInput
): Promise<CoverageBreakdown> {
  const priorApiOnly = isSystemSeasonBlendEnabled();
  const leagueId = apiLeagueId(input.league);

  const [histHome, histAway, coreHome, coreAway, sysHome, sysAway] =
    await Promise.all([
      countHistCornersForTeam(input.homeTeam, input.league),
      countHistCornersForTeam(input.awayTeam, input.league),
      countCoreCornersForTeam(input.homeTeam, input.league),
      countCoreCornersForTeam(input.awayTeam, input.league),
      priorApiOnly && leagueId != null
        ? countSystemSeasonCornersForTeam(input.homeTeam, leagueId)
        : Promise.resolve(undefined),
      priorApiOnly && leagueId != null
        ? countSystemSeasonCornersForTeam(input.awayTeam, leagueId)
        : Promise.resolve(undefined),
    ]);

  return computeCornersCoverageSync({
    ...input,
    histHome,
    histAway,
    coreHome,
    coreAway,
    priorApiOnly,
    ...(priorApiOnly
      ? {
          systemSeasonHome: sysHome ?? { withField: 0, total: 0 },
          systemSeasonAway: sysAway ?? { withField: 0, total: 0 },
        }
      : {}),
  });
}

export function coverageBreakdownLabel(b: CoverageBreakdown): string {
  const apiPct = Math.round(b.effectiveApiWeight * 100);
  const sysPct = Math.round(b.effectiveSystemWeight * 100);
  const apiLabel = isSystemSeasonBlendEnabled() ? "Prior API" : "API";
  const sysLabel = isSystemSeasonBlendEnabled() ? "System season" : "System";
  return `${apiLabel} ${apiPct}% / ${sysLabel} ${sysPct}% (api n=${b.apiRecords}, system n=${b.systemRecords})`;
}

export function loadCornersRatesPair(input: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  batches: PredictionBatch[];
  beforeDate?: string;
}): { home: ClubCornersRates; away: ClubCornersRates } {
  return {
    home: loadClubCornersRates(input.homeTeam, input.league, input.batches, {
      beforeDate: input.beforeDate,
    }),
    away: loadClubCornersRates(input.awayTeam, input.league, input.batches, {
      beforeDate: input.beforeDate,
    }),
  };
}

/** Recompute coverage with Postgres hist + core_fixture enrichment (server paths). */
export async function enrichCoverageAsync(input: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  batches: PredictionBatch[];
  beforeDate?: string;
  homeRates: ClubHalfAttackDefence;
  awayRates: ClubHalfAttackDefence;
}): Promise<{ ht: CoverageBreakdown; corners: CoverageBreakdown }> {
  const cornersRates = loadCornersRatesPair(input);
  const [ht, corners] = await Promise.all([
    computeHtCoverageAsync({
      ...input,
    }),
    computeCornersCoverageAsync({
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      league: input.league,
      batches: input.batches,
      beforeDate: input.beforeDate,
      homeCorners: cornersRates.home,
      awayCorners: cornersRates.away,
    }),
  ]);
  return { ht, corners };
}
