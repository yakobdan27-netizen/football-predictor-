import type { LogMarketKey, LogMatch, MarketActual, MatchTeamStats, TeamSideStats } from "@/lib/prediction-log/types";
import {
  applyGoalsToActuals,
  applyHalfTimeGoalsToActuals,
  ftResult,
} from "@/lib/prediction-log/goal-result-sync";
import { normalizeApiTeamName, fixturePairKey } from "./team-resolve";

export interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string;
    status: { short: string };
    venue?: { name?: string | null; city?: string | null };
  };
  league?: { id?: number; name?: string; logo?: string };
  teams: {
    home: { id?: number; name: string; logo?: string };
    away: { id?: number; name: string; logo?: string };
  };
  goals: { home: number | null; away: number | null };
  score: {
    halftime?: { home: number | null; away: number | null };
  };
}

export interface ApiFootballStatBlock {
  team: { name: string };
  statistics: Array<{ type: string; value: number | string | null }>;
}

export interface ApiFieldConflict {
  matchId: string;
  field: string;
  label: string;
  current: number | string;
  apiValue: number | string;
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

function findBlock(
  blocks: ApiFootballStatBlock[],
  teamName: string
): ApiFootballStatBlock | undefined {
  const key = fixturePairKey(teamName, "x").split("|")[0];
  return blocks.find((b) => {
    const bk = fixturePairKey(b.team.name, "x").split("|")[0];
    return bk === key;
  });
}

function sideStatsFromBlock(block: ApiFootballStatBlock | undefined): TeamSideStats {
  const side: TeamSideStats = {};
  if (!block) return side;
  side.totalShots = statFromBlock(block, "Total Shots") ?? undefined;
  side.shotsOnTarget =
    statFromBlock(block, "Shots on Goal", "Shots on Target") ?? undefined;
  side.corners = statFromBlock(block, "Corner Kicks", "Corners") ?? undefined;
  side.offsides = statFromBlock(block, "Offsides") ?? undefined;
  side.yellowCards = statFromBlock(block, "Yellow Cards") ?? undefined;
  side.redCards = statFromBlock(block, "Red Cards") ?? undefined;
  side.fouls = statFromBlock(block, "Fouls") ?? undefined;
  side.possession =
    statFromBlock(block, "Ball Possession", "Possession") ?? undefined;
  side.throwIns = statFromBlock(block, "Throw-ins", "Throw ins") ?? undefined;
  return side;
}

/** Match stats blocks by team name (not array order). */
export function parseFixtureStatistics(
  blocks: ApiFootballStatBlock[],
  homeTeam?: string,
  awayTeam?: string
): { home: TeamSideStats; away: TeamSideStats } {
  if (homeTeam && awayTeam) {
    return {
      home: sideStatsFromBlock(findBlock(blocks, homeTeam)),
      away: sideStatsFromBlock(findBlock(blocks, awayTeam)),
    };
  }
  // Fallback: first two blocks (legacy)
  return {
    home: sideStatsFromBlock(blocks[0]),
    away: sideStatsFromBlock(blocks[1]),
  };
}

function setTeamStatIfEmpty(
  side: TeamSideStats,
  field: keyof TeamSideStats,
  value: number | undefined
): void {
  if (value == null || side[field] != null) return;
  side[field] = value;
}

/** True when corners (or other side stats) are still missing on the match. */
export function matchNeedsStatistics(match: LogMatch): boolean {
  const home = match.teamStats?.home;
  const away = match.teamStats?.away;
  if (home?.corners == null || away?.corners == null) return true;

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
  if (statMarkets.some((k) => match.predictions[k])) {
    if (home?.totalShots == null || away?.totalShots == null) return true;
    if (home?.shotsOnTarget == null || away?.shotsOnTarget == null) return true;
  }
  return false;
}

function blankActual(v: string | number | undefined | null): boolean {
  if (v == null) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  return false;
}

/**
 * Detect fields where API would differ from an existing manual value.
 * Used for UI warning + Replace (auto-fill never overwrites by default).
 */
export function detectApiConflicts(
  match: LogMatch,
  fixture: ApiFootballFixture,
  statsBlocks: ApiFootballStatBlock[] | null
): ApiFieldConflict[] {
  const conflicts: ApiFieldConflict[] = [];
  const hg = fixture.goals.home;
  const ag = fixture.goals.away;
  const ht = fixture.score.halftime;
  const hthg = ht?.home;
  const htag = ht?.away;

  const pushNum = (
    field: string,
    label: string,
    current: number | null | undefined,
    apiValue: number | null | undefined
  ) => {
    if (current == null || apiValue == null) return;
    if (current === apiValue) return;
    conflicts.push({
      matchId: match.id,
      field,
      label,
      current,
      apiValue,
    });
  };

  pushNum("home.goals", "Home FT", match.teamStats?.home?.goals, hg ?? undefined);
  pushNum("away.goals", "Away FT", match.teamStats?.away?.goals, ag ?? undefined);
  pushNum(
    "home.firstHalfGoals",
    "Home HT",
    match.teamStats?.home?.firstHalfGoals,
    hthg ?? undefined
  );
  pushNum(
    "away.firstHalfGoals",
    "Away HT",
    match.teamStats?.away?.firstHalfGoals,
    htag ?? undefined
  );

  if (statsBlocks?.length) {
    const parsed = parseFixtureStatistics(
      statsBlocks,
      fixture.teams.home.name,
      fixture.teams.away.name
    );
    pushNum(
      "home.corners",
      "Home corners",
      match.teamStats?.home?.corners,
      parsed.home.corners
    );
    pushNum(
      "away.corners",
      "Away corners",
      match.teamStats?.away?.corners,
      parsed.away.corners
    );
  }

  const existing1x2 = match.actualResults["1x2"]?.actual;
  if (hg != null && ag != null && !blankActual(existing1x2)) {
    const api1x2 = ftResult(hg, ag);
    if (String(existing1x2).toLowerCase() !== api1x2) {
      conflicts.push({
        matchId: match.id,
        field: "actual.1x2",
        label: "1X2 actual",
        current: existing1x2 as string | number,
        apiValue: api1x2,
      });
    }
  }

  return conflicts;
}

/**
 * Build API-sourced updates. Never overwrites existing manual teamStats / actuals
 * unless `overwrite` is true (Replace action).
 */
export function mapFixtureToMatchUpdates(
  fixture: ApiFootballFixture,
  statsBlocks: ApiFootballStatBlock[] | null,
  match: LogMatch,
  options?: { overwrite?: boolean }
): Partial<LogMatch> {
  const overwrite = options?.overwrite === true;
  const hg = fixture.goals.home;
  const ag = fixture.goals.away;
  if (hg == null || ag == null) return {};

  const ht = fixture.score.halftime;
  const hthg = ht?.home;
  const htag = ht?.away;
  const hasHt = hthg != null && htag != null;

  const actualResults: Partial<Record<LogMarketKey, MarketActual>> = hasHt
    ? applyHalfTimeGoalsToActuals(match, hg, ag, hthg!, htag!, { overwrite })
    : {
        ...match.actualResults,
        ...applyGoalsToActuals(match, hg, ag, { overwrite }),
      };

  let teamStats: MatchTeamStats | undefined = match.teamStats
    ? {
        home: { ...match.teamStats.home },
        away: { ...match.teamStats.away },
        firstHalfResult: match.teamStats.firstHalfResult,
        goalTiming: match.teamStats.goalTiming,
        firstGoalSide: match.teamStats.firstGoalSide,
        abnormalMatch: match.teamStats.abnormalMatch,
        penaltiesAwarded: match.teamStats.penaltiesAwarded,
        penaltyAwarded: match.teamStats.penaltyAwarded,
      }
    : {
        home: {},
        away: {},
      };

  const setGoal = (
    side: "home" | "away",
    field: "goals" | "firstHalfGoals",
    value: number | null | undefined
  ) => {
    if (value == null) return;
    if (!overwrite && teamStats![side][field] != null) return;
    teamStats![side][field] = value;
  };

  setGoal("home", "goals", hg);
  setGoal("away", "goals", ag);
  if (hasHt) {
    setGoal("home", "firstHalfGoals", hthg);
    setGoal("away", "firstHalfGoals", htag);
    if (overwrite || !teamStats.firstHalfResult) {
      teamStats.firstHalfResult = ftResult(hthg, htag);
    }
  }

  if (statsBlocks?.length) {
    const parsed = parseFixtureStatistics(
      statsBlocks,
      fixture.teams.home.name,
      fixture.teams.away.name
    );
    for (const field of Object.keys(parsed.home) as (keyof TeamSideStats)[]) {
      if (overwrite) {
        const v = parsed.home[field];
        if (v != null) teamStats.home[field] = v;
      } else {
        setTeamStatIfEmpty(teamStats.home, field, parsed.home[field]);
      }
    }
    for (const field of Object.keys(parsed.away) as (keyof TeamSideStats)[]) {
      if (overwrite) {
        const v = parsed.away[field];
        if (v != null) teamStats.away[field] = v;
      } else {
        setTeamStatIfEmpty(teamStats.away, field, parsed.away[field]);
      }
    }
  }

  return {
    actualResults,
    teamStats,
    resultSource: match.resultSource ?? "api-football",
  };
}

export function mergeMatchUpdates(match: LogMatch, updates: Partial<LogMatch>): LogMatch {
  return {
    ...match,
    ...updates,
    actualResults: updates.actualResults ?? match.actualResults,
    teamStats: updates.teamStats ?? match.teamStats,
  };
}

export { normalizeApiTeamName };
