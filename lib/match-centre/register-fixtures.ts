/**
 * Register Match Centre upcoming fixtures into live_fixtures for polling/settlement.
 * Must not import prediction-log writers.
 */
import type { NewLiveFixture, NewLiveLeague } from "@/lib/db/schema";
import { apiSeasonFromDate } from "@/lib/football-api/leagues";
import { isFinishedStatus } from "@/lib/live/normalize";
import {
  getFixtureById,
  upsertFixtures,
  upsertLeague,
} from "@/lib/live/store";

export type MatchCentreFixtureInput = {
  apiFixtureId: number;
  kickoffIso: string;
  matchDate?: string;
  status: string;
  home: { id: number | null; name: string };
  away: { id: number | null; name: string };
  venue: string | null;
  leagueId: number;
  league: string;
};

export function mapToLiveFixture(
  row: MatchCentreFixtureInput,
  syncedAt: Date
): NewLiveFixture {
  const kickoffUtc = new Date(row.kickoffIso);
  const status = (row.status || "NS").trim().toUpperCase();
  const dateKey = row.matchDate ?? row.kickoffIso.slice(0, 10);
  return {
    fixtureId: row.apiFixtureId,
    leagueId: row.leagueId,
    season: apiSeasonFromDate(dateKey),
    homeTeam: row.home.name,
    awayTeam: row.away.name,
    homeId: row.home.id,
    awayId: row.away.id,
    kickoffUtc,
    venue: row.venue,
    status,
    statusMinute: null,
    homeGoals: null,
    awayGoals: null,
    besoccerMatchId: null,
    homeCorners: null,
    awayCorners: null,
    homeShots: null,
    awayShots: null,
    homePossession: null,
    awayPossession: null,
    sourceConflicts: null,
    lastSyncedUtc: syncedAt,
  };
}

/**
 * Idempotent: upserts NS fixtures; skips fixtures already marked finished in live_*.
 */
export async function registerMatchCentreFixtures(
  fixtures: MatchCentreFixtureInput[]
): Promise<{ registered: number; skipped: number }> {
  if (!fixtures.length) return { registered: 0, skipped: 0 };

  const syncedAt = new Date();
  const leagues = new Map<number, NewLiveLeague>();
  const toUpsert: NewLiveFixture[] = [];
  let skipped = 0;

  for (const row of fixtures) {
    if (!row.apiFixtureId || !row.home.name || !row.away.name) continue;
    const existing = await getFixtureById(row.apiFixtureId);
    if (existing && isFinishedStatus(existing.status)) {
      skipped += 1;
      continue;
    }
    if (!leagues.has(row.leagueId)) {
      leagues.set(row.leagueId, {
        leagueId: row.leagueId,
        name: row.league,
        country: null,
        season: apiSeasonFromDate(row.kickoffIso.slice(0, 10)),
        logoUrl: null,
      });
    }
    toUpsert.push(mapToLiveFixture(row, syncedAt));
  }

  for (const league of leagues.values()) {
    await upsertLeague(league);
  }

  if (!toUpsert.length) return { registered: 0, skipped };

  const result = await upsertFixtures(toUpsert);
  return { registered: result.upserted, skipped };
}
