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
  type LiveEvent,
  type LiveFixture,
  type NewLiveEvent,
  type NewLiveFixture,
  type NewLiveLeague,
} from "@/lib/db/schema";
import { LIVE_STATUSES, STALE_MS } from "./constants";
import { isFinishedStatus } from "./normalize";
import { emitFixtureSettled } from "./settled-bus";
import type { LiveFixtureDto, LiveTab } from "./types";

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
  settledEmitted: number;
}> {
  if (!rows.length) return { upserted: 0, settledEmitted: 0 };
  const db = await getDb();
  const ids = rows.map((r) => r.fixtureId);
  const existing = await db
    .select()
    .from(liveFixtures)
    .where(inArray(liveFixtures.fixtureId, ids));
  const byId = new Map(existing.map((e) => [e.fixtureId, e]));

  let settledEmitted = 0;

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
          lastSyncedUtc: row.lastSyncedUtc,
        },
      });

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

  return { upserted: rows.length, settledEmitted };
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
