/**
 * Map API-Football payloads → system_season_* row shapes.
 */
import type {
  NewSystemSeasonFixture,
  NewSystemSeasonGoal,
  NewSystemSeasonLineup,
  NewSystemSeasonStat,
} from "@/lib/db/schema";
import type { LiveApiEvent, LiveApiFixture } from "@/lib/live/types";
import {
  mapFixtureCore,
  mapGoalEvents,
  mapLineups,
  mapStatistics,
  type HistCompleteness,
} from "@/lib/hist/map";

export type SystemSeasonCompleteness = HistCompleteness;

export function mapSystemSeasonFixture(
  raw: LiveApiFixture,
  season: number,
  completeness: SystemSeasonCompleteness,
  syncedAt: Date = new Date()
): NewSystemSeasonFixture | null {
  const core = mapFixtureCore(raw, season, completeness, syncedAt, "league");
  if (!core) return null;
  return {
    fixtureId: core.fixtureId,
    leagueId: core.leagueId,
    season: core.season,
    dateUtc: core.dateUtc,
    homeId: core.homeId,
    awayId: core.awayId,
    homeTeam: core.homeTeam,
    awayTeam: core.awayTeam,
    venue: core.venue,
    htHome: core.htHome,
    htAway: core.htAway,
    ftHome: core.ftHome,
    ftAway: core.ftAway,
    status: core.status,
    dataCompleteness: core.dataCompleteness,
    locked: 0,
    syncedAt,
  };
}

export function mapSystemSeasonGoals(
  fixtureId: number,
  events: LiveApiEvent[]
): NewSystemSeasonGoal[] {
  return mapGoalEvents(fixtureId, events).map((g) => ({
    fixtureId: g.fixtureId,
    teamId: g.teamId,
    minute: g.minute,
    extraMinute: g.extraMinute,
    half: g.half,
    player: g.player,
    type: g.type,
  }));
}

export function mapSystemSeasonStats(
  fixtureId: number,
  stats: Parameters<typeof mapStatistics>[1]
): NewSystemSeasonStat[] {
  return mapStatistics(fixtureId, stats).map((s) => ({
    fixtureId: s.fixtureId,
    teamId: s.teamId,
    shots: s.shots,
    sot: s.sot,
    possession: s.possession,
    corners: s.corners,
    yellow: s.yellow,
    red: s.red,
    fouls: s.fouls,
    offsides: s.offsides,
  }));
}

export function mapSystemSeasonLineups(
  fixtureId: number,
  lineups: Parameters<typeof mapLineups>[1]
): NewSystemSeasonLineup[] {
  const rows = mapLineups(fixtureId, lineups);
  return rows.map((r) => ({
    fixtureId: r.fixtureId,
    teamId: r.teamId,
    formation: r.formation,
    startingJson: null,
    substitutesJson: null,
  }));
}
