/**
 * On-demand bet feed load: prefer fresher live_* rows, else AF fixtures.
 * Writes only bet_*; never touches prediction-log.
 */
import { apiLeagueId, apiSeasonFromDate } from "@/lib/football-api/leagues";
import { LIVE_LEAGUE_IDS, LIVE_STATUSES, STALE_MS } from "@/lib/live/constants";
import { apiSportsLiveProvider } from "@/lib/live/provider";
import { queryFixturesForTab } from "@/lib/live/store";
import type { LiveApiFixture, LiveFixtureDto } from "@/lib/live/types";
import type { BetFeedType } from "./constants";
import {
  softPrefetchOddsForEvents,
  toFeedEventFromLiveDto,
  groupFeedByLeague,
  type BetFeedEvent,
  type BetFeedLeagueGroup,
} from "./feed";

const PRE_NEXT = 20;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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

function afToDto(f: LiveApiFixture, leagueName: string | null): LiveFixtureDto | null {
  const id = f.fixture?.id;
  const leagueId = f.league?.id;
  if (id == null || leagueId == null) return null;
  const home = f.teams?.home?.name?.trim();
  const away = f.teams?.away?.name?.trim();
  if (!home || !away) return null;
  const kickoff = f.fixture?.date;
  if (!kickoff) return null;
  return {
    fixtureId: id,
    leagueId,
    season: f.league?.season ?? apiSeasonFromDate(todayIso()),
    homeTeam: home,
    awayTeam: away,
    homeId: f.teams.home.id ?? null,
    awayId: f.teams.away.id ?? null,
    kickoffUtc: kickoff,
    venue: f.fixture.venue?.name ?? null,
    status: (f.fixture.status?.short ?? "NS").toUpperCase(),
    statusMinute: f.fixture.status?.elapsed ?? null,
    homeGoals: f.goals?.home ?? null,
    awayGoals: f.goals?.away ?? null,
    lastSyncedUtc: new Date().toISOString(),
    leagueName: f.league?.name ?? leagueName,
  };
}

function liveRowsFresh(rows: LiveFixtureDto[], tab: "pre" | "live"): boolean {
  if (!rows.length) return false;
  const maxAge = tab === "live" ? STALE_MS.live : 60 * 60 * 1000;
  const newest = Math.max(
    ...rows.map((r) => new Date(r.lastSyncedUtc).getTime() || 0)
  );
  return Date.now() - newest < maxAge;
}

export type LoadBetGamesResult = {
  ok: boolean;
  groups: BetFeedLeagueGroup[];
  count: number;
  fromLive: number;
  fromApi: number;
  leagueId: number;
  leagueName: string;
  season: number;
  warning?: string;
  error?: string;
};

export async function loadBetGames(opts: {
  league: string;
  tab: "pre" | "live";
}): Promise<LoadBetGamesResult> {
  const leagueName = opts.league.trim();
  const leagueId = apiLeagueId(leagueName);
  if (leagueId == null || !LIVE_LEAGUE_IDS.includes(leagueId)) {
    return {
      ok: false,
      groups: [],
      count: 0,
      fromLive: 0,
      fromApi: 0,
      leagueId: 0,
      leagueName,
      season: apiSeasonFromDate(todayIso()),
      error: `Unsupported league "${leagueName}"`,
    };
  }

  const now = new Date();
  const season = apiSeasonFromDate(todayIso());
  const feedType: BetFeedType = opts.tab === "live" ? "LIVE" : "PRE";
  let fromLive = 0;
  let fromApi = 0;
  let warning: string | undefined;
  const byId = new Map<number, LiveFixtureDto>();

  // Prefer live_* for this league
  try {
    const storeTab = opts.tab === "live" ? "live" : "upcoming";
    const { fixtures } = await queryFixturesForTab({
      tab: storeTab,
      leagueId,
      now,
    });
    const filtered =
      opts.tab === "live"
        ? fixtures.filter(isLive)
        : fixtures.filter((f) => isPreMatch(f, now));
    if (liveRowsFresh(filtered, opts.tab) || filtered.length > 0) {
      for (const f of filtered) {
        byId.set(f.fixtureId, f);
        fromLive += 1;
      }
    }
  } catch {
    // fall through to AF
  }

  // AF when empty or always merge for live (fresher scores)
  const needApi =
    byId.size === 0 || opts.tab === "live" || !liveRowsFresh([...byId.values()], opts.tab);

  if (needApi) {
    try {
      if (opts.tab === "live") {
        const raw = await apiSportsLiveProvider.fetchLiveAll();
        for (const row of raw) {
          const dto = afToDto(row, leagueName);
          if (!dto || dto.leagueId !== leagueId) continue;
          if (!isLive(dto)) continue;
          byId.set(dto.fixtureId, dto);
          fromApi += 1;
        }
      } else {
        const raw = await apiSportsLiveProvider.fetchNext(
          leagueId,
          season,
          PRE_NEXT
        );
        for (const row of raw) {
          const dto = afToDto(row, leagueName);
          if (!dto) continue;
          if (!isPreMatch(dto, now)) continue;
          byId.set(dto.fixtureId, dto);
          fromApi += 1;
        }
      }
    } catch (e) {
      warning = e instanceof Error ? e.message : "API fixtures failed";
      if (byId.size === 0) {
        return {
          ok: false,
          groups: [],
          count: 0,
          fromLive,
          fromApi: 0,
          leagueId,
          leagueName,
          season,
          error: warning,
        };
      }
    }
  }

  const list = [...byId.values()];
  if (opts.tab === "live") {
    list.sort((a, b) => (b.statusMinute ?? 0) - (a.statusMinute ?? 0));
  } else {
    list.sort(
      (a, b) =>
        new Date(a.kickoffUtc).getTime() - new Date(b.kickoffUtc).getTime()
    );
  }

  const events: BetFeedEvent[] = [];
  for (const f of list) {
    events.push(await toFeedEventFromLiveDto(f, feedType));
  }
  const withOdds = await softPrefetchOddsForEvents(events);

  return {
    ok: true,
    groups: groupFeedByLeague(withOdds),
    count: withOdds.length,
    fromLive,
    fromApi,
    leagueId,
    leagueName,
    season,
    warning:
      withOdds.length === 0
        ? "No games found for this league"
        : warning,
  };
}
