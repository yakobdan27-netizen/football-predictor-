import { evaluateBatchCombos } from "./combo-selection";
import { loadCombinedOddsSettings } from "./combo-settings";
import { ftResult } from "./goal-result-sync";
import type { TeamsQualityStore } from "./teams-quality-types";
import type {
  AnalysisHistory,
  CombinedOddsSettings,
  LearnerStatsStore,
  LogMarketKey,
  MarketActual,
  MatchTeamStats,
  PredictionBatch,
  ScoreResult,
} from "./types";

function parseNum(actual: string | number | undefined): number | undefined {
  if (actual == null) return undefined;
  const n = typeof actual === "number" ? actual : parseFloat(String(actual));
  return Number.isFinite(n) ? n : undefined;
}

function getGoals(
  actualResults: Partial<Record<LogMarketKey, MarketActual>>,
  teamStats?: MatchTeamStats
): { home?: number; away?: number } {
  const home = teamStats?.home?.goals ?? parseNum(actualResults.home_goals_ou?.actual);
  const away = teamStats?.away?.goals ?? parseNum(actualResults.away_goals_ou?.actual);
  return { home, away };
}

function resultFromActuals(
  actualResults: Partial<Record<LogMarketKey, MarketActual>>,
  teamStats?: MatchTeamStats
): "home" | "draw" | "away" | null {
  const r = actualResults["1x2"]?.actual;
  if (r === "home" || r === "draw" || r === "away") return r;
  const { home, away } = getGoals(actualResults, teamStats);
  if (home != null && away != null) return ftResult(home, away);
  return null;
}

function bttsFromActuals(
  actualResults: Partial<Record<LogMarketKey, MarketActual>>,
  teamStats?: MatchTeamStats
): boolean | null {
  const btts = actualResults.btts?.actual;
  if (btts === "yes") return true;
  if (btts === "no") return false;
  const { home, away } = getGoals(actualResults, teamStats);
  if (home != null && away != null) return home >= 1 && away >= 1;
  return null;
}

function totalGoals(
  actualResults: Partial<Record<LogMarketKey, MarketActual>>,
  teamStats?: MatchTeamStats
): number | null {
  const { home, away } = getGoals(actualResults, teamStats);
  if (home != null && away != null) return home + away;
  return null;
}

function htResult(
  actualResults: Partial<Record<LogMarketKey, MarketActual>>,
  teamStats?: MatchTeamStats
): "home" | "draw" | "away" | null {
  const ht = actualResults.ht_1x2?.actual;
  if (ht === "home" || ht === "draw" || ht === "away") return ht;
  if (teamStats?.firstHalfResult) return teamStats.firstHalfResult;
  const hth = teamStats?.home?.firstHalfGoals;
  const ath = teamStats?.away?.firstHalfGoals;
  if (hth != null && ath != null && Number.isFinite(hth) && Number.isFinite(ath)) {
    return ftResult(hth, ath);
  }
  return null;
}

function fhGoals(
  actualResults: Partial<Record<LogMarketKey, MarketActual>>,
  teamStats?: MatchTeamStats
): number | null {
  const hth = teamStats?.home?.firstHalfGoals;
  const ath = teamStats?.away?.firstHalfGoals;
  if (hth != null && ath != null && Number.isFinite(hth) && Number.isFinite(ath)) {
    return hth + ath;
  }
  void actualResults;
  return null;
}

const COMBO_EVALUATORS: Record<
  string,
  (
    actualResults: Partial<Record<LogMarketKey, MarketActual>>,
    teamStats?: MatchTeamStats
  ) => boolean | null
> = {
  home_btts_yes: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const b = bttsFromActuals(ar, ts);
    return r != null && b != null ? r === "home" && b : null;
  },
  home_btts_no: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const b = bttsFromActuals(ar, ts);
    return r != null && b != null ? r === "home" && !b : null;
  },
  away_btts_yes: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const b = bttsFromActuals(ar, ts);
    return r != null && b != null ? r === "away" && b : null;
  },
  away_btts_no: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const b = bttsFromActuals(ar, ts);
    return r != null && b != null ? r === "away" && !b : null;
  },
  draw_btts_yes: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const b = bttsFromActuals(ar, ts);
    return r != null && b != null ? r === "draw" && b : null;
  },
  home_over_1_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r === "home" && t > 1.5 : null;
  },
  home_over_2_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r === "home" && t > 2.5 : null;
  },
  home_under_3_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r === "home" && t < 3.5 : null;
  },
  away_over_1_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r === "away" && t > 1.5 : null;
  },
  away_over_2_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r === "away" && t > 2.5 : null;
  },
  away_under_3_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r === "away" && t < 3.5 : null;
  },
  draw_under_2_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r === "draw" && t < 2.5 : null;
  },
  "1x_over_1_5": (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? (r === "home" || r === "draw") && t > 1.5 : null;
  },
  "1x_btts_yes": (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const b = bttsFromActuals(ar, ts);
    return r != null && b != null ? (r === "home" || r === "draw") && b : null;
  },
  x2_over_1_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? (r === "away" || r === "draw") && t > 1.5 : null;
  },
  x2_btts_yes: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const b = bttsFromActuals(ar, ts);
    return r != null && b != null ? (r === "away" || r === "draw") && b : null;
  },
  "12_over_2_5": (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r !== "draw" && t > 2.5 : null;
  },
  "12_btts_yes": (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const b = bttsFromActuals(ar, ts);
    return r != null && b != null ? r !== "draw" && b : null;
  },
  btts_yes_over_2_5: (ar, ts) => {
    const b = bttsFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return b != null && t != null ? b && t > 2.5 : null;
  },
  btts_yes_over_3_5: (ar, ts) => {
    const b = bttsFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return b != null && t != null ? b && t > 3.5 : null;
  },
  btts_no_under_2_5: (ar, ts) => {
    const b = bttsFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return b != null && t != null ? !b && t < 2.5 : null;
  },
  btts_no_over_1_5: (ar, ts) => {
    const b = bttsFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return b != null && t != null ? !b && t > 1.5 : null;
  },
  btts_no_under_3_5: (ar, ts) => {
    const b = bttsFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return b != null && t != null ? !b && t < 3.5 : null;
  },
  "1x_over_2_5": (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? (r === "home" || r === "draw") && t > 2.5 : null;
  },
  "1x_under_3_5": (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? (r === "home" || r === "draw") && t < 3.5 : null;
  },
  x2_over_2_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? (r === "away" || r === "draw") && t > 2.5 : null;
  },
  x2_under_3_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? (r === "away" || r === "draw") && t < 3.5 : null;
  },
  "12_over_1_5": (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r !== "draw" && t > 1.5 : null;
  },
  "12_under_3_5": (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r !== "draw" && t < 3.5 : null;
  },
  home_2_3_goals: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r === "home" && t >= 2 && t <= 3 : null;
  },
  away_2_3_goals: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r === "away" && t >= 2 && t <= 3 : null;
  },
  draw_0_2_goals: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const t = totalGoals(ar, ts);
    return r != null && t != null ? r === "draw" && t >= 0 && t <= 2 : null;
  },
  home_win_home_over_1_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const { home } = getGoals(ar, ts);
    return r != null && home != null ? r === "home" && home > 1.5 : null;
  },
  away_win_away_over_1_5: (ar, ts) => {
    const r = resultFromActuals(ar, ts);
    const { away } = getGoals(ar, ts);
    return r != null && away != null ? r === "away" && away > 1.5 : null;
  },
  btts_yes_home_over_1_5: (ar, ts) => {
    const b = bttsFromActuals(ar, ts);
    const { home } = getGoals(ar, ts);
    return b != null && home != null ? b && home > 1.5 : null;
  },
  home_ht_home_ft: (ar, ts) => {
    const ht = htResult(ar, ts);
    const ft = resultFromActuals(ar, ts);
    return ht != null && ft != null ? ht === "home" && ft === "home" : null;
  },
  draw_ht_home_ft: (ar, ts) => {
    const ht = htResult(ar, ts);
    const ft = resultFromActuals(ar, ts);
    return ht != null && ft != null ? ht === "draw" && ft === "home" : null;
  },
  over_0_5_fh_over_2_5_ft: (ar, ts) => {
    const fh = fhGoals(ar, ts);
    const t = totalGoals(ar, ts);
    return fh != null && t != null ? fh >= 1 && t > 2.5 : null;
  },
};

export function scoreComboLeg(
  comboId: string,
  actualResults: Partial<Record<LogMarketKey, MarketActual>>,
  teamStats?: MatchTeamStats
): ScoreResult {
  const evaluator = COMBO_EVALUATORS[comboId];
  if (!evaluator) return null;
  const hit = evaluator(actualResults, teamStats);
  if (hit == null) return "void";
  return hit ? "correct" : "wrong";
}

/** Aggregate combo legs: any wrong → wrong; any void (no wrong) → void; all correct → correct. */
export function aggregateComboResults(results: ScoreResult[]): ScoreResult {
  const known = results.filter((r) => r != null);
  if (known.length === 0) return null;
  if (known.some((r) => r === "wrong")) return "wrong";
  if (known.some((r) => r === "void")) return "void";
  if (known.every((r) => r === "correct")) return "correct";
  return null;
}

export function explainComboResult(
  comboId: string,
  result: ScoreResult,
  actualResults: Partial<Record<LogMarketKey, MarketActual>>,
  teamStats?: MatchTeamStats
): string {
  const label = comboId.replace(/_/g, " ");
  if (result === "void") {
    return `Void: ${label} cannot be graded (missing required stats).`;
  }
  if (result == null) {
    return `Pending: ${label} not yet graded.`;
  }
  const { home, away } = getGoals(actualResults, teamStats);
  const score =
    home != null && away != null ? `FT ${home}-${away}` : "FT unknown";
  if (result === "correct") {
    return `Correct: ${label} hit (${score}).`;
  }
  return `Wrong: ${label} missed (${score}).`;
}

export interface ComboScoredLeg {
  matchId: string;
  comboId: string;
  result: ScoreResult;
}

export function scoreComboAccumulator(legs: ComboScoredLeg[]): boolean | null {
  const scored = legs.filter((l) => l.result === "correct" || l.result === "wrong");
  if (scored.length === 0) return null;
  return scored.every((l) => l.result === "correct");
}

export function scoreRecommendedBatchCombos(
  batch: PredictionBatch,
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory | null,
  settings?: CombinedOddsSettings,
  teamsQuality?: TeamsQualityStore | null,
  learnerStats?: LearnerStatsStore | null
): PredictionBatch {
  if (batch.batchKind !== "recommended" || !batch.recommended) return batch;

  const comboSettings = settings ?? loadCombinedOddsSettings();
  const { matches: comboMatches, accumulator } = evaluateBatchCombos(
    batch,
    comboSettings,
    analysis,
    allBatches,
    teamsQuality,
    learnerStats
  );

  const comboScoredByMatch: Record<string, ScoreResult> = {};
  const comboPickByMatch: Record<string, string> = {};
  const scoredLegs: ComboScoredLeg[] = [];

  for (const logMatch of batch.matches) {
    const comboResult = comboMatches.find((m) => m.matchId === logMatch.id);
    const comboId =
      logMatch.comboPick?.comboId ??
      comboResult?.selected?.comboId ??
      batch.recommended?.comboPickByMatch?.[logMatch.id];
    if (!comboId) continue;
    comboPickByMatch[logMatch.id] = comboId;
    const result = scoreComboLeg(comboId, logMatch.actualResults, logMatch.teamStats);
    if (result != null) {
      comboScoredByMatch[logMatch.id] = result;
      scoredLegs.push({ matchId: logMatch.id, comboId, result });
    }
  }

  const accaLegs: ComboScoredLeg[] = [];
  for (const leg of accumulator.legs) {
    const scored = comboScoredByMatch[leg.matchId];
    const comboId = leg.selected?.comboId;
    if (!comboId || scored == null || scored === "push") continue;
    if (scored === "void") continue;
    accaLegs.push({ matchId: leg.matchId, comboId, result: scored });
  }

  const comboAccumulatorWon =
    accaLegs.length > 0 ? scoreComboAccumulator(accaLegs) : null;

  return {
    ...batch,
    recommended: {
      ...batch.recommended,
      comboScoredByMatch,
      comboPickByMatch,
      comboAccumulatorWon,
    },
  };
}

export function collectComboLearnerUpdates(
  batches: PredictionBatch[]
): Record<string, { wins: number; losses: number }> {
  const stats: Record<string, { wins: number; losses: number }> = {};
  for (const batch of batches) {
    if (batch.batchKind !== "recommended" || !batch.recommended?.comboScoredByMatch) continue;
    for (const [matchId, result] of Object.entries(batch.recommended.comboScoredByMatch)) {
      if (result !== "correct" && result !== "wrong") continue;
      const id = batch.recommended.comboPickByMatch?.[matchId];
      if (!id) continue;
      if (!stats[id]) stats[id] = { wins: 0, losses: 0 };
      if (result === "correct") stats[id]!.wins++;
      else stats[id]!.losses++;
    }
  }
  return stats;
}
