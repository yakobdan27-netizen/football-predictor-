import type { NewLiveEvent, NewLiveFixture, NewLiveLeague } from "@/lib/db/schema";
import { LIVE_STATUSES } from "./constants";
import type { LiveApiEvent, LiveApiFixture } from "./types";

function asIntOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  return null;
}

export function isFinishedStatus(status: string): boolean {
  return LIVE_STATUSES.finished.has(status.toUpperCase());
}

export function isInPlayStatus(status: string): boolean {
  return LIVE_STATUSES.inPlay.has(status.toUpperCase());
}

export function normalizeLeague(
  fixture: LiveApiFixture,
  seasonFallback: number
): NewLiveLeague | null {
  const leagueId = fixture.league?.id;
  if (leagueId == null || !Number.isFinite(leagueId)) return null;
  const name = fixture.league?.name?.trim();
  if (!name) return null;
  return {
    leagueId,
    name,
    country: fixture.league?.country?.trim() || null,
    season: fixture.league?.season ?? seasonFallback,
    logoUrl: fixture.league?.logo?.trim() || null,
  };
}

export function normalizeFixture(
  fixture: LiveApiFixture,
  syncedAt: Date
): NewLiveFixture | null {
  const fixtureId = fixture.fixture?.id;
  if (fixtureId == null || !Number.isFinite(fixtureId)) return null;
  const leagueId = fixture.league?.id;
  if (leagueId == null || !Number.isFinite(leagueId)) return null;
  const kickoff = fixture.fixture?.date;
  if (!kickoff) return null;
  const kickoffUtc = new Date(kickoff);
  if (Number.isNaN(kickoffUtc.getTime())) return null;

  const homeTeam = fixture.teams?.home?.name?.trim();
  const awayTeam = fixture.teams?.away?.name?.trim();
  if (!homeTeam || !awayTeam) return null;

  const status = (fixture.fixture.status?.short ?? "NS").trim().toUpperCase();
  const elapsed = asIntOrNull(fixture.fixture.status?.elapsed);
  const finished = isFinishedStatus(status);
  const inPlay = isInPlayStatus(status);

  return {
    fixtureId,
    leagueId,
    season: fixture.league?.season ?? kickoffUtc.getUTCFullYear(),
    homeTeam,
    awayTeam,
    homeId: asIntOrNull(fixture.teams.home.id),
    awayId: asIntOrNull(fixture.teams.away.id),
    kickoffUtc,
    venue: fixture.fixture.venue?.name?.trim() || null,
    status,
    statusMinute: finished ? null : inPlay ? elapsed : null,
    homeGoals: asIntOrNull(fixture.goals?.home),
    awayGoals: asIntOrNull(fixture.goals?.away),
    lastSyncedUtc: syncedAt,
    settledEmittedAt: undefined,
  };
}

export function normalizeEvents(
  fixtureId: number,
  events: LiveApiEvent[]
): NewLiveEvent[] {
  return events.map((e) => ({
    fixtureId,
    minute: asIntOrNull(e.time?.elapsed),
    type: e.type?.trim() || e.detail?.trim() || null,
    team: e.team?.name?.trim() || null,
    player: e.player?.name?.trim() || null,
  }));
}
