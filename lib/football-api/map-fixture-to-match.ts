import type { LogMarketKey, LogMatch, MarketActual, MatchTeamStats, TeamSideStats } from "@/lib/prediction-log/types";
import {
  applyGoalsToActuals,
  applyHalfTimeGoalsToActuals,
  ftResult,
} from "@/lib/prediction-log/goal-result-sync";

export interface ApiFootballFixture {
  fixture: { id: number; date: string; status: { short: string } };
  teams: { home: { name: string }; away: { name: string } };
  goals: { home: number | null; away: number | null };
  score: {
    halftime?: { home: number | null; away: number | null };
  };
}

export interface ApiFootballStatBlock {
  team: { name: string };
  statistics: Array<{ type: string; value: number | string | null }>;
}

function parseStatValue(value: number | string | null): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim();
  if (s.endsWith("%")) {
    const n = parseFloat(s.slice(0, -1));
    return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function statFromBlock(block: ApiFootballStatBlock, ...types: string[]): number | null {
  for (const t of types) {
    const row = block.statistics.find((s) => s.type === t);
    if (row) {
      const v = parseStatValue(row.value);
      if (v != null) return v;
    }
  }
  return null;
}

export function parseFixtureStatistics(
  blocks: ApiFootballStatBlock[]
): { home: TeamSideStats; away: TeamSideStats } {
  const homeBlock = blocks[0];
  const awayBlock = blocks[1];
  const home: TeamSideStats = {};
  const away: TeamSideStats = {};

  if (homeBlock) {
    home.totalShots = statFromBlock(homeBlock, "Total Shots") ?? undefined;
    home.shotsOnTarget = statFromBlock(homeBlock, "Shots on Goal", "Shots on Target") ?? undefined;
    home.corners = statFromBlock(homeBlock, "Corner Kicks", "Corners") ?? undefined;
    home.offsides = statFromBlock(homeBlock, "Offsides") ?? undefined;
    home.yellowCards = statFromBlock(homeBlock, "Yellow Cards") ?? undefined;
    home.redCards = statFromBlock(homeBlock, "Red Cards") ?? undefined;
    home.fouls = statFromBlock(homeBlock, "Fouls") ?? undefined;
    home.possession = statFromBlock(homeBlock, "Ball Possession", "Possession") ?? undefined;
    home.throwIns = statFromBlock(homeBlock, "Throw-ins", "Throw ins") ?? undefined;
  }
  if (awayBlock) {
    away.totalShots = statFromBlock(awayBlock, "Total Shots") ?? undefined;
    away.shotsOnTarget = statFromBlock(awayBlock, "Shots on Goal", "Shots on Target") ?? undefined;
    away.corners = statFromBlock(awayBlock, "Corner Kicks", "Corners") ?? undefined;
    away.offsides = statFromBlock(awayBlock, "Offsides") ?? undefined;
    away.yellowCards = statFromBlock(awayBlock, "Yellow Cards") ?? undefined;
    away.redCards = statFromBlock(awayBlock, "Red Cards") ?? undefined;
    away.fouls = statFromBlock(awayBlock, "Fouls") ?? undefined;
    away.possession = statFromBlock(awayBlock, "Ball Possession", "Possession") ?? undefined;
    away.throwIns = statFromBlock(awayBlock, "Throw-ins", "Throw ins") ?? undefined;
  }

  return { home, away };
}

function setTeamStatIfEmpty(
  side: TeamSideStats,
  field: keyof TeamSideStats,
  value: number | undefined
): void {
  if (value == null || side[field] != null) return;
  side[field] = value;
}

export function matchNeedsStatistics(match: LogMatch): boolean {
  const statMarkets: LogMarketKey[] = [
    "shots_ou",
    "home_shots_ou",
    "away_shots_ou",
    "sot_ou",
    "home_sot_ou",
    "away_sot_ou",
    "corners_ou",
    "throw_ins_ou",
    "offsides_ou",
  ];
  if (statMarkets.some((k) => match.predictions[k])) return true;
  return false;
}

export function mapFixtureToMatchUpdates(
  fixture: ApiFootballFixture,
  statsBlocks: ApiFootballStatBlock[] | null,
  match: LogMatch
): Partial<LogMatch> {
  const hg = fixture.goals.home;
  const ag = fixture.goals.away;
  if (hg == null || ag == null) return {};

  const ht = fixture.score.halftime;
  const hthg = ht?.home;
  const htag = ht?.away;
  const hasHt = hthg != null && htag != null;

  const actualResults: Partial<Record<LogMarketKey, MarketActual>> = hasHt
    ? applyHalfTimeGoalsToActuals(match, hg, ag, hthg!, htag!, { overwrite: false })
    : {
        ...match.actualResults,
        ...applyGoalsToActuals(match, hg, ag, { overwrite: false }),
      };

  let teamStats: MatchTeamStats | undefined = match.teamStats
    ? {
        home: { ...match.teamStats.home, goals: match.teamStats.home.goals ?? hg },
        away: { ...match.teamStats.away, goals: match.teamStats.away.goals ?? ag },
        firstHalfResult: match.teamStats.firstHalfResult,
      }
    : {
        home: { goals: hg },
        away: { goals: ag },
      };

  if (hasHt && !teamStats.firstHalfResult) {
    teamStats.firstHalfResult = ftResult(hthg, htag);
  }

  if (statsBlocks?.length) {
    const parsed = parseFixtureStatistics(statsBlocks);
    for (const field of Object.keys(parsed.home) as (keyof TeamSideStats)[]) {
      setTeamStatIfEmpty(teamStats.home, field, parsed.home[field]);
    }
    for (const field of Object.keys(parsed.away) as (keyof TeamSideStats)[]) {
      setTeamStatIfEmpty(teamStats.away, field, parsed.away[field]);
    }
  }

  const update: Partial<LogMatch> = { actualResults };
  if (teamStats) update.teamStats = teamStats;
  return update;
}

export function mergeMatchUpdates(match: LogMatch, updates: Partial<LogMatch>): LogMatch {
  return {
    ...match,
    ...updates,
    actualResults: updates.actualResults ?? match.actualResults,
    teamStats: updates.teamStats ?? match.teamStats,
  };
}
