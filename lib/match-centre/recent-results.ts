/**
 * Read finished Match Centre results from live_* (no prediction-log).
 */
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { liveEvents, liveFixtures, liveLeagues, matchStats } from "@/lib/db/schema";
import { LEAGUE_API_IDS } from "@/lib/football-api/leagues";
import { LIVE_LEAGUE_IDS, LIVE_STATUSES } from "@/lib/live/constants";
import type { NextMatchesLeague } from "@/lib/football-api/fetch-upcoming-league";

export type RecentResultGoal = {
  minute: number | null;
  team: string | null;
  type: string | null;
  player: string | null;
};

export type RecentMatchCentreResult = {
  fixtureId: number;
  leagueId: number;
  leagueName: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoffUtc: string;
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
  homeGoals1h: number | null;
  awayGoals1h: number | null;
  homeCorners: number | null;
  awayCorners: number | null;
  goals: RecentResultGoal[];
};

function halfGoalsFromEvents(
  events: RecentResultGoal[],
  home: string,
  away: string
): { homeGoals1h: number | null; awayGoals1h: number | null } {
  const goals = events.filter((e) => {
    const t = (e.type ?? "").toLowerCase();
    return t.includes("goal") && !t.includes("missed");
  });
  if (!goals.length) return { homeGoals1h: null, awayGoals1h: null };

  let homeGoals1h = 0;
  let awayGoals1h = 0;
  let saw1h = false;
  for (const g of goals) {
    const minute = g.minute ?? 99;
    if (minute > 45) continue;
    saw1h = true;
    const team = (g.team ?? "").trim();
    if (team === home) homeGoals1h += 1;
    else if (team === away) awayGoals1h += 1;
  }
  if (!saw1h) return { homeGoals1h: null, awayGoals1h: null };
  return { homeGoals1h, awayGoals1h };
}

export async function queryRecentMatchCentreResults(opts?: {
  league?: NextMatchesLeague | null;
  hours?: number;
  limit?: number;
}): Promise<RecentMatchCentreResult[]> {
  const hours = Math.max(1, Math.min(168, opts?.hours ?? 48));
  const limit = Math.max(1, Math.min(50, opts?.limit ?? 20));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const finished = [...LIVE_STATUSES.finished];

  let leagueIds = LIVE_LEAGUE_IDS;
  if (opts?.league) {
    const id = LEAGUE_API_IDS[opts.league];
    if (id == null) return [];
    leagueIds = [id];
  }

  const db = await getDb();
  const rows = await db
    .select({
      fixture: liveFixtures,
      leagueName: liveLeagues.name,
    })
    .from(liveFixtures)
    .leftJoin(liveLeagues, eq(liveFixtures.leagueId, liveLeagues.leagueId))
    .where(
      and(
        inArray(liveFixtures.leagueId, leagueIds),
        inArray(liveFixtures.status, finished),
        gte(liveFixtures.kickoffUtc, since)
      )
    )
    .orderBy(desc(liveFixtures.kickoffUtc))
    .limit(limit);

  if (!rows.length) return [];

  const fixtureIds = rows.map((r) => r.fixture.fixtureId);
  const eventRows = await db
    .select()
    .from(liveEvents)
    .where(inArray(liveEvents.fixtureId, fixtureIds))
    .orderBy(asc(liveEvents.minute), asc(liveEvents.id));

  const statsRows = await db
    .select()
    .from(matchStats)
    .where(inArray(matchStats.fixtureId, fixtureIds));

  const eventsByFixture = new Map<number, RecentResultGoal[]>();
  for (const e of eventRows) {
    const list = eventsByFixture.get(e.fixtureId) ?? [];
    list.push({
      minute: e.minute,
      team: e.team,
      type: e.type,
      player: e.player,
    });
    eventsByFixture.set(e.fixtureId, list);
  }

  const statsByFixture = new Map(statsRows.map((s) => [s.fixtureId, s] as const));

  return rows.map(({ fixture: f, leagueName }) => {
    const goals = eventsByFixture.get(f.fixtureId) ?? [];
    const stats = statsByFixture.get(f.fixtureId);
    const { homeGoals1h, awayGoals1h } = halfGoalsFromEvents(
      goals,
      f.homeTeam,
      f.awayTeam
    );
    return {
      fixtureId: f.fixtureId,
      leagueId: f.leagueId,
      leagueName: leagueName ?? null,
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
      kickoffUtc: f.kickoffUtc.toISOString(),
      status: f.status,
      homeGoals: f.homeGoals,
      awayGoals: f.awayGoals,
      homeGoals1h,
      awayGoals1h,
      homeCorners: f.homeCorners ?? stats?.homeCorners ?? null,
      awayCorners: f.awayCorners ?? stats?.awayCorners ?? null,
      goals,
    };
  });
}
