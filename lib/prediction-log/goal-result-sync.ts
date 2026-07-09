import type { LogMarketKey, LogMatch, MarketActual } from "./types";

export type ResultSide = "home" | "draw" | "away";

export function ftResult(homeGoals: number, awayGoals: number): ResultSide {
  if (homeGoals > awayGoals) return "home";
  if (awayGoals > homeGoals) return "away";
  return "draw";
}

export function doubleChanceActual(result: ResultSide, prediction?: string): string {
  const winners: Record<ResultSide, string[]> = {
    home: ["1x", "12"],
    draw: ["1x", "x2"],
    away: ["x2", "12"],
  };
  const list = winners[result];
  const p = (prediction ?? "").toLowerCase();
  if (list.includes(p)) return p;
  return list[0]!;
}

export function winOneHalfActual(
  hthg: number,
  htag: number,
  hg: number,
  ag: number,
  prediction?: string
): string {
  const homeWon1h = hthg > htag;
  const awayWon1h = htag > hthg;
  const shg = hg - hthg;
  const sag = ag - htag;
  const homeWon2h = shg > sag;
  const awayWon2h = sag > shg;
  const homeWonHalf = homeWon1h || homeWon2h;
  const awayWonHalf = awayWon1h || awayWon2h;
  const result = homeWonHalf && !awayWonHalf ? "home" : awayWonHalf && !homeWonHalf ? "away" : "draw";
  if (result === "draw") return prediction === "draw" ? "draw" : "home";
  if (prediction === result) return prediction;
  return result;
}

function isBlankActual(actual: string | number | undefined | null): boolean {
  if (actual == null) return true;
  if (typeof actual === "string") return actual.trim() === "";
  return false;
}

function setActual(
  actualResults: Partial<Record<LogMarketKey, MarketActual>>,
  key: LogMarketKey,
  value: string | number,
  overwrite: boolean
): void {
  if (!overwrite && !isBlankActual(actualResults[key]?.actual)) return;
  actualResults[key] = { actual: value };
}

export interface ApplyGoalsOptions {
  /** When false, only fill markets with no actual yet (API sync). Default true for manual entry. */
  overwrite?: boolean;
}

export function applyGoalsToActuals(
  match: LogMatch,
  homeGoals: number,
  awayGoals: number,
  options: ApplyGoalsOptions = {}
): Partial<Record<LogMarketKey, MarketActual>> {
  const overwrite = options.overwrite !== false;
  const actualResults = { ...match.actualResults };
  const predictions = match.predictions;
  const result = ftResult(homeGoals, awayGoals);

  if (predictions["1x2"]) setActual(actualResults, "1x2", result, overwrite);
  if (predictions.btts) {
    setActual(actualResults, "btts", homeGoals > 0 && awayGoals > 0 ? "yes" : "no", overwrite);
  }
  if (predictions.home_goals_ou) setActual(actualResults, "home_goals_ou", homeGoals, overwrite);
  if (predictions.away_goals_ou) setActual(actualResults, "away_goals_ou", awayGoals, overwrite);
  if (predictions.double_chance) {
    setActual(
      actualResults,
      "double_chance",
      doubleChanceActual(result, predictions.double_chance.prediction),
      overwrite
    );
  }

  return actualResults;
}

export function applyHalfTimeGoalsToActuals(
  match: LogMatch,
  homeGoals: number,
  awayGoals: number,
  hthg: number,
  htag: number,
  options: ApplyGoalsOptions = {}
): Partial<Record<LogMarketKey, MarketActual>> {
  const overwrite = options.overwrite !== false;
  const actualResults = applyGoalsToActuals(match, homeGoals, awayGoals, options);
  const predictions = match.predictions;
  const htRes = ftResult(hthg, htag);

  if (predictions.ht_1x2) setActual(actualResults, "ht_1x2", htRes, overwrite);
  if (predictions.more_goals_half) {
    const g1 = hthg + htag;
    const g2 = homeGoals - hthg + (awayGoals - htag);
    const more = g1 > g2 ? "first_half" : g2 > g1 ? "second_half" : "equal";
    setActual(actualResults, "more_goals_half", more, overwrite);
  }
  if (predictions.draw_one_half) {
    const draw1h = hthg === htag;
    const draw2h = homeGoals - hthg === awayGoals - htag;
    setActual(actualResults, "draw_one_half", draw1h || draw2h ? "yes" : "no", overwrite);
  }
  if (predictions.win_one_half) {
    setActual(
      actualResults,
      "win_one_half",
      winOneHalfActual(hthg, htag, homeGoals, awayGoals, predictions.win_one_half.prediction),
      overwrite
    );
  }

  return actualResults;
}

function parseGoalActual(actual: string | number | undefined): number | undefined {
  if (actual == null) return undefined;
  const n = typeof actual === "number" ? actual : parseFloat(String(actual));
  return Number.isFinite(n) ? n : undefined;
}

export function getFinalScoreDisplay(match: LogMatch): {
  homeGoals?: number;
  awayGoals?: number;
} {
  const fromStats = {
    homeGoals: match.teamStats?.home?.goals,
    awayGoals: match.teamStats?.away?.goals,
  };
  if (fromStats.homeGoals != null && fromStats.awayGoals != null) {
    return fromStats;
  }
  const homeFromOu = parseGoalActual(match.actualResults.home_goals_ou?.actual);
  const awayFromOu = parseGoalActual(match.actualResults.away_goals_ou?.actual);
  return {
    homeGoals: fromStats.homeGoals ?? homeFromOu,
    awayGoals: fromStats.awayGoals ?? awayFromOu,
  };
}

export function bothFinalGoalsSet(match: LogMatch): boolean {
  const { homeGoals, awayGoals } = getFinalScoreDisplay(match);
  return homeGoals != null && awayGoals != null && Number.isFinite(homeGoals) && Number.isFinite(awayGoals);
}

export function getHalfTimeGoalsDisplay(match: LogMatch): {
  homeGoals?: number;
  awayGoals?: number;
} {
  return {
    homeGoals: match.teamStats?.home?.firstHalfGoals,
    awayGoals: match.teamStats?.away?.firstHalfGoals,
  };
}

export function bothHalfTimeGoalsSet(match: LogMatch): boolean {
  const { homeGoals, awayGoals } = getHalfTimeGoalsDisplay(match);
  return homeGoals != null && awayGoals != null && Number.isFinite(homeGoals) && Number.isFinite(awayGoals);
}

export function applyHalfTimeGoalsToActualsFromStats(match: LogMatch): Partial<Record<LogMarketKey, MarketActual>> {
  const hth = match.teamStats?.home?.firstHalfGoals;
  const hta = match.teamStats?.away?.firstHalfGoals;
  if (hth == null || hta == null) return match.actualResults;
  const hg = match.teamStats?.home?.goals;
  const ag = match.teamStats?.away?.goals;
  if (hg == null || ag == null) {
    return {
      ...match.actualResults,
      ht_1x2: { actual: ftResult(hth, hta) },
    };
  }
  return applyHalfTimeGoalsToActuals(match, hg, ag, hth, hta, { overwrite: true });
}
