/**
 * Postgres store for live_* tables only.
 * Must not import prediction-log / manual-results writers.
 */
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  liveEvents,
  liveFixtures,
  liveLeagues,
  liveSyncMeta,
  matchStats,
  type LiveEvent,
  type LiveFixture,
  type MatchStats,
  type NewLiveEvent,
  type NewLiveFixture,
  type NewLiveLeague,
  type NewMatchStats,
} from "@/lib/db/schema";
import { LIVE_LEAGUE_IDS, LIVE_STATUSES, STALE_MS } from "./constants";
import { isFinishedStatus } from "./normalize";
import { emitFixtureSettled } from "./settled-bus";
import type {
  LiveFixtureDto,
  LiveSourceConflictDto,
  LiveSyncMetaDto,
  LiveTab,
} from "./types";

function parseSourceConflicts(
  raw: string | null | undefined
): LiveSourceConflictDto[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is LiveSourceConflictDto =>
        !!c &&
        typeof c === "object" &&
        typeof (c as LiveSourceConflictDto).field === "string"
    );
  } catch {
    return [];
  }
}

export type LiveSyncStatus = "ok" | "empty" | "error" | "quota" | "auth";

export async function upsertLeague(row: NewLiveLeague): Promise<void> {
  const db = await getDb();
  await db
    .insert(liveLeagues)
    .values(row)
    .onConflictDoUpdate({
      target: liveLeagues.leagueId,
      set: {
        name: row.name,
        country: row.country,
        season: row.season,
        logoUrl: row.logoUrl,
      },
    });
}

export async function upsertFixtures(rows: NewLiveFixture[]): Promise<{
  upserted: number;
  inserted: number;
  updated: number;
  skipped: number;
  settledEmitted: number;
}> {
  if (!rows.length) {
    return { upserted: 0, inserted: 0, updated: 0, skipped: 0, settledEmitted: 0 };
  }
  const db = await getDb();
  const ids = rows.map((r) => r.fixtureId);
  const existing = await db
    .select()
    .from(liveFixtures)
    .where(inArray(liveFixtures.fixtureId, ids));
  const byId = new Map(existing.map((e) => [e.fixtureId, e]));

  let settledEmitted = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const prev = byId.get(row.fixtureId);
    const finished = isFinishedStatus(row.status);
    let settledEmittedAt = prev?.settledEmittedAt ?? null;

    // Freeze goals once settled if API briefly clears them
    let homeGoals: number | null = row.homeGoals ?? null;
    let awayGoals: number | null = row.awayGoals ?? null;
    if (
      finished &&
      homeGoals == null &&
      awayGoals == null &&
      prev?.homeGoals != null &&
      prev?.awayGoals != null
    ) {
      homeGoals = prev.homeGoals;
      awayGoals = prev.awayGoals;
    }

    const statusMinute = finished ? null : (row.statusMinute ?? null);

    try {
      await db
        .insert(liveFixtures)
        .values({
          ...row,
          homeGoals,
          awayGoals,
          statusMinute,
          settledEmittedAt,
        })
        .onConflictDoUpdate({
          target: liveFixtures.fixtureId,
          set: {
            leagueId: row.leagueId,
            season: row.season,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            homeId: row.homeId,
            awayId: row.awayId,
            kickoffUtc: row.kickoffUtc,
            venue: row.venue,
            status: row.status,
            statusMinute,
            homeGoals,
            awayGoals,
            besoccerMatchId:
              row.besoccerMatchId ?? prev?.besoccerMatchId ?? null,
            homeCorners: row.homeCorners ?? prev?.homeCorners ?? null,
            awayCorners: row.awayCorners ?? prev?.awayCorners ?? null,
            homeShots: row.homeShots ?? prev?.homeShots ?? null,
            awayShots: row.awayShots ?? prev?.awayShots ?? null,
            homePossession: row.homePossession ?? prev?.homePossession ?? null,
            awayPossession: row.awayPossession ?? prev?.awayPossession ?? null,
            sourceConflicts:
              row.sourceConflicts ?? prev?.sourceConflicts ?? null,
            lastSyncedUtc: row.lastSyncedUtc,
          },
        });
      if (prev) updated += 1;
      else inserted += 1;
    } catch (e) {
      skipped += 1;
      console.warn(
        "[live] upsert skipped fixture",
        row.fixtureId,
        e instanceof Error ? e.message : e
      );
      continue;
    }

    if (finished && !settledEmittedAt) {
      await emitFixtureSettled({
        fixtureId: row.fixtureId,
        home: row.homeTeam,
        away: row.awayTeam,
        homeGoals,
        awayGoals,
        leagueId: row.leagueId,
        status: row.status,
      });
      const stamped = new Date();
      await db
        .update(liveFixtures)
        .set({ settledEmittedAt: stamped })
        .where(eq(liveFixtures.fixtureId, row.fixtureId));
      settledEmitted += 1;
    }
  }

  return {
    upserted: inserted + updated,
    inserted,
    updated,
    skipped,
    settledEmitted,
  };
}

/** Upsert canonical match statistics into `match_stats`. */
export async function upsertMatchStats(
  rows: NewMatchStats[]
): Promise<{ upserted: number; inserted: number; updated: number; skipped: number }> {
  if (!rows.length) {
    return { upserted: 0, inserted: 0, updated: 0, skipped: 0 };
  }
  const db = await getDb();
  const ids = rows.map((r) => r.fixtureId);
  const existing = await db
    .select()
    .from(matchStats)
    .where(inArray(matchStats.fixtureId, ids));
  const byId = new Map(existing.map((e) => [e.fixtureId, e]));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const prev = byId.get(row.fixtureId);
    try {
      await db
        .insert(matchStats)
        .values(row)
        .onConflictDoUpdate({
          target: matchStats.fixtureId,
          set: {
            statsApiMatchId:
              row.statsApiMatchId ?? prev?.statsApiMatchId ?? null,
            leagueId: row.leagueId ?? prev?.leagueId ?? null,
            season: row.season ?? prev?.season ?? null,
            homeTeam: row.homeTeam,
            awayTeam: row.awayTeam,
            kickoffUtc: row.kickoffUtc ?? prev?.kickoffUtc ?? null,
            status: row.status ?? prev?.status ?? null,
            homeGoals: row.homeGoals ?? prev?.homeGoals ?? null,
            awayGoals: row.awayGoals ?? prev?.awayGoals ?? null,
            homeCorners: row.homeCorners ?? prev?.homeCorners ?? null,
            awayCorners: row.awayCorners ?? prev?.awayCorners ?? null,
            homeShots: row.homeShots ?? prev?.homeShots ?? null,
            awayShots: row.awayShots ?? prev?.awayShots ?? null,
            homePossession: row.homePossession ?? prev?.homePossession ?? null,
            awayPossession: row.awayPossession ?? prev?.awayPossession ?? null,
            homeShotsOnTarget:
              row.homeShotsOnTarget ?? prev?.homeShotsOnTarget ?? null,
            awayShotsOnTarget:
              row.awayShotsOnTarget ?? prev?.awayShotsOnTarget ?? null,
            homeXg: row.homeXg ?? prev?.homeXg ?? null,
            awayXg: row.awayXg ?? prev?.awayXg ?? null,
            homeBigChances: row.homeBigChances ?? prev?.homeBigChances ?? null,
            awayBigChances: row.awayBigChances ?? prev?.awayBigChances ?? null,
            homeGkSaves: row.homeGkSaves ?? prev?.homeGkSaves ?? null,
            awayGkSaves: row.awayGkSaves ?? prev?.awayGkSaves ?? null,
            homeFouls: row.homeFouls ?? prev?.homeFouls ?? null,
            awayFouls: row.awayFouls ?? prev?.awayFouls ?? null,
            homeYellowCards:
              row.homeYellowCards ?? prev?.homeYellowCards ?? null,
            awayYellowCards:
              row.awayYellowCards ?? prev?.awayYellowCards ?? null,
            homeRedCards: row.homeRedCards ?? prev?.homeRedCards ?? null,
            awayRedCards: row.awayRedCards ?? prev?.awayRedCards ?? null,
            homePasses: row.homePasses ?? prev?.homePasses ?? null,
            awayPasses: row.awayPasses ?? prev?.awayPasses ?? null,
            homeAccuratePasses:
              row.homeAccuratePasses ?? prev?.homeAccuratePasses ?? null,
            awayAccuratePasses:
              row.awayAccuratePasses ?? prev?.awayAccuratePasses ?? null,
            homeTackles: row.homeTackles ?? prev?.homeTackles ?? null,
            awayTackles: row.awayTackles ?? prev?.awayTackles ?? null,
            homeFreeKicks: row.homeFreeKicks ?? prev?.homeFreeKicks ?? null,
            awayFreeKicks: row.awayFreeKicks ?? prev?.awayFreeKicks ?? null,
            rawJson: row.rawJson ?? prev?.rawJson ?? null,
            sourceConflicts:
              row.sourceConflicts ?? prev?.sourceConflicts ?? null,
            provider: row.provider,
            fetchedAt: row.fetchedAt,
            updatedAt: row.updatedAt,
          },
        });
      if (prev) updated += 1;
      else inserted += 1;
    } catch (e) {
      skipped += 1;
      console.warn(
        "[match-stats] upsert skipped",
        row.fixtureId,
        e instanceof Error ? e.message : e
      );
    }
  }

  return {
    upserted: inserted + updated,
    inserted,
    updated,
    skipped,
  };
}

export async function getMatchStatsByFixtureId(
  fixtureId: number
): Promise<MatchStats | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(matchStats)
    .where(eq(matchStats.fixtureId, fixtureId))
    .limit(1);
  return rows[0] ?? null;
}

export async function writeSyncMeta(meta: {
  status: LiveSyncStatus;
  reason: string | null;
  from: string | null;
  to: string | null;
  fetched: number;
  upserted: number;
}): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db
    .insert(liveSyncMeta)
    .values({
      id: 1,
      lastSyncAt: now,
      lastSyncStatus: meta.status,
      lastSyncReason: meta.reason,
      lastFrom: meta.from,
      lastTo: meta.to,
      lastFetched: meta.fetched,
      lastUpserted: meta.upserted,
    })
    .onConflictDoUpdate({
      target: liveSyncMeta.id,
      set: {
        lastSyncAt: now,
        lastSyncStatus: meta.status,
        lastSyncReason: meta.reason,
        lastFrom: meta.from,
        lastTo: meta.to,
        lastFetched: meta.fetched,
        lastUpserted: meta.upserted,
      },
    });
}

export async function readSyncMeta(): Promise<LiveSyncMetaDto | null> {
  try {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(liveSyncMeta)
      .where(eq(liveSyncMeta.id, 1))
      .limit(1);
    if (!row) return null;
    return {
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      status: (row.lastSyncStatus as LiveSyncStatus | null) ?? null,
      reason: row.lastSyncReason ?? null,
      from: row.lastFrom ?? null,
      to: row.lastTo ?? null,
      fetched: row.lastFetched ?? null,
      upserted: row.lastUpserted ?? null,
    };
  } catch {
    return null;
  }
}

export async function replaceEventsForFixture(
  fixtureId: number,
  events: NewLiveEvent[]
): Promise<void> {
  const db = await getDb();
  await db.delete(liveEvents).where(eq(liveEvents.fixtureId, fixtureId));
  if (events.length) {
    await db.insert(liveEvents).values(events);
  }
}

export async function getEventsForFixture(
  fixtureId: number
): Promise<LiveEvent[]> {
  const db = await getDb();
  return db
    .select()
    .from(liveEvents)
    .where(eq(liveEvents.fixtureId, fixtureId))
    .orderBy(asc(liveEvents.minute), asc(liveEvents.id));
}

export async function getFixtureById(
  fixtureId: number
): Promise<LiveFixture | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(liveFixtures)
    .where(eq(liveFixtures.fixtureId, fixtureId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listFixtureIdsNeedingLivePoll(now = new Date()): Promise<
  number[]
> {
  const db = await getDb();
  const windowStart = new Date(now.getTime() - 15 * 60_000);
  const windowEnd = new Date(now.getTime() + 3 * 60 * 60_000);
  const inPlay = [...LIVE_STATUSES.inPlay];
  const terminal = ["FT", "AET", "PEN", "CANC", "PST", "ABD"];

  const rows = await db
    .select({ fixtureId: liveFixtures.fixtureId })
    .from(liveFixtures)
    .where(
      or(
        inArray(liveFixtures.status, inPlay),
        and(
          gte(liveFixtures.kickoffUtc, windowStart),
          lte(liveFixtures.kickoffUtc, windowEnd),
          notInArray(liveFixtures.status, terminal)
        )
      )
    );

  return rows.map((r) => r.fixtureId);
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
  );
}

function endOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
  );
}

export async function queryFixturesForTab(opts: {
  tab: LiveTab;
  leagueId?: number | null;
  now?: Date;
}): Promise<{ fixtures: LiveFixtureDto[]; syncedAt: string | null; stale: boolean }> {
  const db = await getDb();
  const now = opts.now ?? new Date();
  const conditions = [];
  if (opts.leagueId != null) {
    conditions.push(eq(liveFixtures.leagueId, opts.leagueId));
  }

  if (opts.tab === "live") {
    conditions.push(inArray(liveFixtures.status, [...LIVE_STATUSES.inPlay]));
  } else if (opts.tab === "today") {
    conditions.push(gte(liveFixtures.kickoffUtc, startOfUtcDay(now)));
    conditions.push(lte(liveFixtures.kickoffUtc, endOfUtcDay(now)));
  } else if (opts.tab === "upcoming") {
    conditions.push(gte(liveFixtures.kickoffUtc, now));
    conditions.push(
      inArray(liveFixtures.status, [
        ...LIVE_STATUSES.scheduled,
        ...LIVE_STATUSES.disrupted,
        "NS",
        "TBD",
        "PST",
      ])
    );
  } else if (opts.tab === "finished") {
    conditions.push(inArray(liveFixtures.status, [...LIVE_STATUSES.finished]));
    // Last 14 days of finished
    conditions.push(gte(liveFixtures.kickoffUtc, new Date(now.getTime() - 14 * 86400_000)));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select({
      fixture: liveFixtures,
      leagueName: liveLeagues.name,
      leagueLogoUrl: liveLeagues.logoUrl,
    })
    .from(liveFixtures)
    .leftJoin(liveLeagues, eq(liveFixtures.leagueId, liveLeagues.leagueId))
    .where(where)
    .orderBy(
      opts.tab === "finished" ? sql`${liveFixtures.kickoffUtc} desc` : asc(liveFixtures.kickoffUtc)
    )
    .limit(200);

  const fixtures: LiveFixtureDto[] = rows.map((r) => ({
    fixtureId: r.fixture.fixtureId,
    leagueId: r.fixture.leagueId,
    season: r.fixture.season,
    homeTeam: r.fixture.homeTeam,
    awayTeam: r.fixture.awayTeam,
    homeId: r.fixture.homeId,
    awayId: r.fixture.awayId,
    kickoffUtc: r.fixture.kickoffUtc.toISOString(),
    venue: r.fixture.venue,
    status: r.fixture.status,
    statusMinute: r.fixture.statusMinute,
    homeGoals: r.fixture.homeGoals,
    awayGoals: r.fixture.awayGoals,
    besoccerMatchId: r.fixture.besoccerMatchId ?? null,
    homeCorners: r.fixture.homeCorners ?? null,
    awayCorners: r.fixture.awayCorners ?? null,
    homeShots: r.fixture.homeShots ?? null,
    awayShots: r.fixture.awayShots ?? null,
    homePossession: r.fixture.homePossession ?? null,
    awayPossession: r.fixture.awayPossession ?? null,
    sourceConflicts: parseSourceConflicts(r.fixture.sourceConflicts),
    lastSyncedUtc: r.fixture.lastSyncedUtc.toISOString(),
    leagueName: r.leagueName,
    leagueLogoUrl: r.leagueLogoUrl,
  }));

  let newest: number | null = null;
  for (const f of fixtures) {
    const t = Date.parse(f.lastSyncedUtc);
    if (Number.isFinite(t) && (newest == null || t > newest)) newest = t;
  }
  // Also consider global max sync if tab empty
  if (newest == null) {
    const [agg] = await db
      .select({ max: sql<string | null>`max(${liveFixtures.lastSyncedUtc})` })
      .from(liveFixtures);
    if (agg?.max) newest = Date.parse(String(agg.max));
  }

  const threshold =
    opts.tab === "live" ? STALE_MS.live : STALE_MS.schedule;
  const syncedAt = newest != null ? new Date(newest).toISOString() : null;
  const stale =
    newest == null ? true : Date.now() - newest > threshold;

  return { fixtures, syncedAt, stale };
}

export async function listFixturesKickoffBetween(
  from: Date,
  to: Date
): Promise<LiveFixture[]> {
  const db = await getDb();
  return db
    .select()
    .from(liveFixtures)
    .where(
      and(gte(liveFixtures.kickoffUtc, from), lt(liveFixtures.kickoffUtc, to))
    );
}

/**
 * Sample-day DB lookup: tracked-league live_fixtures for a UTC calendar day,
 * left-joined with match_stats.
 */
export async function listSampleDayFromDb(dateIso: string): Promise<
  Array<{
    fixture: LiveFixture;
    leagueName: string | null;
    stats: MatchStats | null;
  }>
> {
  const db = await getDb();
  const from = new Date(`${dateIso}T00:00:00.000Z`);
  const to = new Date(`${dateIso}T23:59:59.999Z`);
  // end exclusive for kickoff range
  const toExclusive = new Date(to.getTime() + 1);

  const rows = await db
    .select({
      fixture: liveFixtures,
      leagueName: liveLeagues.name,
      stats: matchStats,
    })
    .from(liveFixtures)
    .leftJoin(liveLeagues, eq(liveFixtures.leagueId, liveLeagues.leagueId))
    .leftJoin(matchStats, eq(liveFixtures.fixtureId, matchStats.fixtureId))
    .where(
      and(
        gte(liveFixtures.kickoffUtc, from),
        lt(liveFixtures.kickoffUtc, toExclusive),
        inArray(liveFixtures.leagueId, [...LIVE_LEAGUE_IDS])
      )
    )
    .orderBy(asc(liveFixtures.kickoffUtc));

  return rows.map((r) => ({
    fixture: r.fixture,
    leagueName: r.leagueName,
    stats: r.stats?.fixtureId != null ? r.stats : null,
  }));
}
