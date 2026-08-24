/**
 * Hydrate live_fixtures / match_stats from API-Football /fixtures/statistics.
 */
import type { LiveFixture, NewLiveFixture, NewMatchStats } from "@/lib/db/schema";
import { liveFixtures } from "@/lib/db/schema";
import {
  parseFixtureStatistics,
  type ApiFootballStatBlock,
} from "@/lib/football-api/map-fixture-to-match";
import { LEAGUE_API_IDS } from "@/lib/football-api/leagues";
import { LIVE_SYNC_LEAGUES } from "./constants";
import { addDaysIso, todayIsoDate } from "./dates";
import { isFinishedStatus } from "./normalize";
import {
  apiSportsLiveProvider,
  type LiveFixturesProvider,
} from "./provider";
import { getDb } from "@/lib/db";
import {
  getFixtureById,
  getMatchStatsByFixtureId,
  upsertFixtures,
  upsertMatchStats,
} from "./store";
import type { LiveBeSoccerEnrichment } from "./types";
import { sleep } from "@/lib/football-api/client";
import { and, gte, inArray, isNull, or, sql } from "drizzle-orm";

export type ApiStatisticsHydration = {
  enrichment: Partial<LiveBeSoccerEnrichment>;
  rawJson: string;
};

function asIntOrNull(v: number | undefined): number | null {
  return v != null && Number.isFinite(v) ? Math.trunc(v) : null;
}

/** True when both corner counts are already stored. */
export function hasCornerData(row: {
  homeCorners?: number | null;
  awayCorners?: number | null;
}): boolean {
  return row.homeCorners != null && row.awayCorners != null;
}

/** Skip hydration when BeSoccer enrichment or DB row already has corners. */
export function fixtureNeedsStatisticsHydration(
  existing: { homeCorners?: number | null; awayCorners?: number | null } | null,
  enrich?: Partial<LiveBeSoccerEnrichment> | null
): boolean {
  if (enrich && hasCornerData(enrich)) return false;
  if (existing && hasCornerData(existing)) return false;
  return true;
}

export function enrichmentFromApiStatistics(
  blocks: unknown[],
  homeTeam: string,
  awayTeam: string
): Partial<LiveBeSoccerEnrichment> | null {
  if (!blocks.length) return null;
  const parsed = parseFixtureStatistics(
    blocks as ApiFootballStatBlock[],
    homeTeam,
    awayTeam
  );
  const enrichment: Partial<LiveBeSoccerEnrichment> = {
    homeCorners: asIntOrNull(parsed.home.corners),
    awayCorners: asIntOrNull(parsed.away.corners),
    homeShots: asIntOrNull(parsed.home.totalShots),
    awayShots: asIntOrNull(parsed.away.totalShots),
    homePossession: asIntOrNull(parsed.home.possession),
    awayPossession: asIntOrNull(parsed.away.possession),
    homeShotsOnTarget: asIntOrNull(parsed.home.shotsOnTarget),
    awayShotsOnTarget: asIntOrNull(parsed.away.shotsOnTarget),
  };
  const hasAny =
    enrichment.homeCorners != null ||
    enrichment.awayCorners != null ||
    enrichment.homeShots != null ||
    enrichment.awayShots != null ||
    enrichment.homePossession != null ||
    enrichment.awayPossession != null ||
    enrichment.homeShotsOnTarget != null ||
    enrichment.awayShotsOnTarget != null;
  return hasAny ? enrichment : null;
}

export async function hydrateFixtureStatistics(
  fixtureId: number,
  homeTeam: string,
  awayTeam: string,
  provider: LiveFixturesProvider = apiSportsLiveProvider
): Promise<ApiStatisticsHydration | null> {
  const blocks = await provider.fetchStatistics(fixtureId);
  const enrichment = enrichmentFromApiStatistics(blocks, homeTeam, awayTeam);
  if (!enrichment) return null;
  return {
    enrichment,
    rawJson: JSON.stringify(blocks),
  };
}

function liveFixtureToUpsertRow(
  fixture: LiveFixture,
  enrich: Partial<LiveBeSoccerEnrichment>,
  syncedAt: Date
): NewLiveFixture {
  return {
    fixtureId: fixture.fixtureId,
    leagueId: fixture.leagueId,
    season: fixture.season,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeId: fixture.homeId,
    awayId: fixture.awayId,
    kickoffUtc: fixture.kickoffUtc,
    venue: fixture.venue,
    status: fixture.status,
    statusMinute: fixture.statusMinute,
    homeGoals: fixture.homeGoals,
    awayGoals: fixture.awayGoals,
    besoccerMatchId: fixture.besoccerMatchId ?? null,
    homeCorners: enrich.homeCorners ?? fixture.homeCorners ?? null,
    awayCorners: enrich.awayCorners ?? fixture.awayCorners ?? null,
    homeShots: enrich.homeShots ?? fixture.homeShots ?? null,
    awayShots: enrich.awayShots ?? fixture.awayShots ?? null,
    homePossession: enrich.homePossession ?? fixture.homePossession ?? null,
    awayPossession: enrich.awayPossession ?? fixture.awayPossession ?? null,
    sourceConflicts: fixture.sourceConflicts ?? null,
    lastSyncedUtc: syncedAt,
  };
}

function buildApiFootballMatchStatsRow(
  fixture: LiveFixture,
  enrich: Partial<LiveBeSoccerEnrichment>,
  rawJson: string,
  syncedAt: Date,
  prev: Awaited<ReturnType<typeof getMatchStatsByFixtureId>>
): NewMatchStats {
  return {
    fixtureId: fixture.fixtureId,
    statsApiMatchId: prev?.statsApiMatchId ?? fixture.besoccerMatchId ?? null,
    leagueId: fixture.leagueId,
    season: fixture.season,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    kickoffUtc: fixture.kickoffUtc,
    status: fixture.status,
    homeGoals: fixture.homeGoals ?? null,
    awayGoals: fixture.awayGoals ?? null,
    homeCorners: enrich.homeCorners ?? prev?.homeCorners ?? null,
    awayCorners: enrich.awayCorners ?? prev?.awayCorners ?? null,
    homeShots: enrich.homeShots ?? prev?.homeShots ?? null,
    awayShots: enrich.awayShots ?? prev?.awayShots ?? null,
    homePossession: enrich.homePossession ?? prev?.homePossession ?? null,
    awayPossession: enrich.awayPossession ?? prev?.awayPossession ?? null,
    homeShotsOnTarget:
      enrich.homeShotsOnTarget ?? prev?.homeShotsOnTarget ?? null,
    awayShotsOnTarget:
      enrich.awayShotsOnTarget ?? prev?.awayShotsOnTarget ?? null,
    homeXg: prev?.homeXg ?? null,
    awayXg: prev?.awayXg ?? null,
    homeBigChances: prev?.homeBigChances ?? null,
    awayBigChances: prev?.awayBigChances ?? null,
    homeGkSaves: prev?.homeGkSaves ?? null,
    awayGkSaves: prev?.awayGkSaves ?? null,
    homeFouls: prev?.homeFouls ?? null,
    awayFouls: prev?.awayFouls ?? null,
    homeYellowCards: prev?.homeYellowCards ?? null,
    awayYellowCards: prev?.awayYellowCards ?? null,
    homeRedCards: prev?.homeRedCards ?? null,
    awayRedCards: prev?.awayRedCards ?? null,
    homePasses: prev?.homePasses ?? null,
    awayPasses: prev?.awayPasses ?? null,
    homeAccuratePasses: prev?.homeAccuratePasses ?? null,
    awayAccuratePasses: prev?.awayAccuratePasses ?? null,
    homeTackles: prev?.homeTackles ?? null,
    awayTackles: prev?.awayTackles ?? null,
    homeFreeKicks: prev?.homeFreeKicks ?? null,
    awayFreeKicks: prev?.awayFreeKicks ?? null,
    rawJson: prev?.rawJson ?? rawJson,
    sourceConflicts: prev?.sourceConflicts ?? null,
    provider:
      prev?.provider === "thestatsapi" && hasCornerData(prev)
        ? prev.provider
        : "api-football",
    fetchedAt: syncedAt,
    updatedAt: syncedAt,
  };
}

/** Persist API-Football statistics onto live_fixtures and match_stats. */
export async function persistApiFootballStatistics(
  fixture: LiveFixture,
  enrich: Partial<LiveBeSoccerEnrichment>,
  rawJson: string,
  syncedAt: Date = new Date()
): Promise<{ matchStatsUpserted: number }> {
  await upsertFixtures([liveFixtureToUpsertRow(fixture, enrich, syncedAt)]);

  const prev = await getMatchStatsByFixtureId(fixture.fixtureId);
  if (
    prev?.provider === "thestatsapi" &&
    (hasCornerData(prev) ||
      prev.homeShots != null ||
      prev.homePossession != null ||
      prev.homeXg != null)
  ) {
    return { matchStatsUpserted: 0 };
  }

  const statsRow = buildApiFootballMatchStatsRow(
    fixture,
    enrich,
    rawJson,
    syncedAt,
    prev
  );
  const result = await upsertMatchStats([statsRow]);
  return { matchStatsUpserted: result.upserted };
}

const FINISHED = ["FT", "AET", "PEN"] as const;

export async function listFinishedFixturesMissingCorners(opts: {
  limit: number;
  days?: number;
}): Promise<LiveFixture[]> {
  const db = await getDb();
  const days = opts.days ?? 30;
  const from = addDaysIso(todayIsoDate(), -days);
  const leagueIds = LIVE_SYNC_LEAGUES.map(
    (name) => LEAGUE_API_IDS[name as keyof typeof LEAGUE_API_IDS]
  ).filter((id): id is number => id != null);

  const rows = await db
    .select()
    .from(liveFixtures)
    .where(
      and(
        inArray(liveFixtures.leagueId, leagueIds),
        inArray(liveFixtures.status, [...FINISHED]),
        gte(liveFixtures.kickoffUtc, new Date(`${from}T00:00:00.000Z`)),
        or(
          isNull(liveFixtures.homeCorners),
          isNull(liveFixtures.awayCorners)
        )
      )
    )
    .orderBy(sql`${liveFixtures.kickoffUtc} desc`)
    .limit(opts.limit);

  return rows;
}

export type BackfillApiStatisticsSummary = {
  ok: boolean;
  processed: number;
  hydrated: number;
  errors: string[];
};

/** Quota-safe backfill for finished fixtures missing corners. */
export async function runBackfillApiStatistics(opts?: {
  limit?: number;
  days?: number;
  sleepMs?: number;
  provider?: LiveFixturesProvider;
}): Promise<BackfillApiStatisticsSummary> {
  const limit = opts?.limit ?? 20;
  const sleepMs = opts?.sleepMs ?? 150;
  const provider = opts?.provider ?? apiSportsLiveProvider;
  const errors: string[] = [];
  let hydrated = 0;

  const missing = await listFinishedFixturesMissingCorners({
    limit,
    days: opts?.days,
  });

  for (const fixture of missing) {
    if (!isFinishedStatus(fixture.status)) continue;
    try {
      const result = await hydrateFixtureStatistics(
        fixture.fixtureId,
        fixture.homeTeam,
        fixture.awayTeam,
        provider
      );
      if (!result) continue;
      await persistApiFootballStatistics(
        fixture,
        result.enrichment,
        result.rawJson
      );
      hydrated += 1;
      await sleep(sleepMs);
    } catch (e) {
      errors.push(
        `${fixture.fixtureId}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return {
    ok: errors.length === 0,
    processed: missing.length,
    hydrated,
    errors,
  };
}

export async function hydrateAndPersistFixtureStatisticsIfNeeded(
  fixtureId: number,
  provider: LiveFixturesProvider = apiSportsLiveProvider
): Promise<boolean> {
  const fixture = await getFixtureById(fixtureId);
  if (!fixture || !isFinishedStatus(fixture.status)) return false;
  if (!fixtureNeedsStatisticsHydration(fixture)) return false;

  const result = await hydrateFixtureStatistics(
    fixtureId,
    fixture.homeTeam,
    fixture.awayTeam,
    provider
  );
  if (!result) return false;

  await persistApiFootballStatistics(
    fixture,
    result.enrichment,
    result.rawJson
  );
  return true;
}
