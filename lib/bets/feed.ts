/**
 * Build Pre-Match / Live feed from shared live_* tables (read-only).
 */
import { LIVE_STATUSES } from "@/lib/live/constants";
import { queryFixturesForTab } from "@/lib/live/store";
import type { LiveFixtureDto } from "@/lib/live/types";
import type { BetFeedType } from "./constants";
import {
  ensureManualSkeletonMarkets,
  listMarketsForEvent,
  upsertBetEventFromLive,
} from "./store";
import type { BetMarket } from "@/lib/db/schema";

export type BetFeedEvent = {
  betEventId: number;
  apiFixtureId: number;
  leagueId: number;
  leagueName: string | null;
  home: string;
  away: string;
  kickoffUtc: string;
  status: string;
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
  feedType: BetFeedType;
  markets: BetMarket[];
};

export type BetFeedLeagueGroup = {
  leagueId: number;
  leagueName: string;
  events: BetFeedEvent[];
};

function isPreMatch(f: LiveFixtureDto, now: Date): boolean {
  const kick = new Date(f.kickoffUtc);
  const scheduled =
    LIVE_STATUSES.scheduled.has(f.status.toUpperCase()) ||
    f.status.toUpperCase() === "NS" ||
    f.status.toUpperCase() === "TBD";
  return scheduled && kick.getTime() > now.getTime();
}

function isLive(f: LiveFixtureDto): boolean {
  return LIVE_STATUSES.inPlay.has(f.status.toUpperCase());
}

export async function toFeedEventFromLiveDto(
  f: LiveFixtureDto,
  feedType: BetFeedType
): Promise<BetFeedEvent> {
  const event = await upsertBetEventFromLive({
    apiFixtureId: f.fixtureId,
    leagueId: f.leagueId,
    home: f.homeTeam,
    away: f.awayTeam,
    kickoffUtc: new Date(f.kickoffUtc),
    status: f.status,
    minute: f.statusMinute,
    homeScore: f.homeGoals,
    awayScore: f.awayGoals,
    feedType,
  });

  let markets = await listMarketsForEvent(event.id);
  if (!markets.length) {
    markets = await ensureManualSkeletonMarkets(event.id);
  }

  return {
    betEventId: event.id,
    apiFixtureId: f.fixtureId,
    leagueId: f.leagueId,
    leagueName: f.leagueName ?? null,
    home: f.homeTeam,
    away: f.awayTeam,
    kickoffUtc: f.kickoffUtc,
    status: f.status,
    minute: f.statusMinute,
    homeScore: f.homeGoals,
    awayScore: f.awayGoals,
    feedType,
    markets,
  };
}

export function groupFeedByLeague(events: BetFeedEvent[]): BetFeedLeagueGroup[] {
  const map = new Map<number, BetFeedLeagueGroup>();
  for (const e of events) {
    let g = map.get(e.leagueId);
    if (!g) {
      g = {
        leagueId: e.leagueId,
        leagueName: e.leagueName ?? `League ${e.leagueId}`,
        events: [],
      };
      map.set(e.leagueId, g);
    }
    g.events.push(e);
  }
  return [...map.values()].sort((a, b) =>
    a.leagueName.localeCompare(b.leagueName)
  );
}

const PREFETCH_ODDS_MAX = 8;

export async function softPrefetchOddsForEvents(
  events: BetFeedEvent[]
): Promise<BetFeedEvent[]> {
  const { fetchAndCacheOddsForFixture } = await import("./odds-fetch");
  const out: BetFeedEvent[] = [];
  let fetched = 0;
  for (const e of events) {
    const needsOdds =
      !e.markets.some((m) => m.source === "API" && m.odd != null) &&
      fetched < PREFETCH_ODDS_MAX;
    if (needsOdds) {
      try {
        const result = await fetchAndCacheOddsForFixture(e.apiFixtureId);
        fetched += 1;
        out.push({ ...e, markets: result.markets });
        continue;
      } catch {
        // Manual skeleton already present — never block feed
      }
    }
    out.push(e);
  }
  return out;
}

export async function buildBetFeed(
  tab: "pre" | "live"
): Promise<{ groups: BetFeedLeagueGroup[]; count: number }> {
  const now = new Date();

  if (tab === "live") {
    const { fixtures } = await queryFixturesForTab({ tab: "live", now });
    const live = fixtures.filter(isLive);
    live.sort((a, b) => (b.statusMinute ?? 0) - (a.statusMinute ?? 0));
    const events = [];
    for (const f of live) {
      events.push(await toFeedEventFromLiveDto(f, "LIVE"));
    }
    // Soft-refresh odds for visible live events (capped; never blocks feed).
    const withOdds = await softPrefetchOddsForEvents(events);
    return { groups: groupFeedByLeague(withOdds), count: withOdds.length };
  }

  // Pre-match: upcoming from live store, then filter future NS
  const { fixtures } = await queryFixturesForTab({ tab: "upcoming", now });
  const pre = fixtures.filter((f) => isPreMatch(f, now));
  pre.sort(
    (a, b) => new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime()
  );
  const events = [];
  for (const f of pre) {
    events.push(await toFeedEventFromLiveDto(f, "PRE"));
  }
  const withOdds = await softPrefetchOddsForEvents(events);
  return { groups: groupFeedByLeague(withOdds), count: withOdds.length };
}
