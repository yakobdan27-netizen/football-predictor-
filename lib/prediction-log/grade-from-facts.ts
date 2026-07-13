import { scoreComboLeg, explainComboResult } from "./combo-scoring";
import {
  doubleChanceActual,
  ftResult,
  winOneHalfActual,
} from "./goal-result-sync";
import { LOG_MARKETS, LOG_MARKET_MAP } from "./markets-config";
import {
  resolveMarketMode,
  singleMarketKey,
} from "./match-entry-helpers";
import { scoreMarket } from "./score-market";
import type {
  FrozenBetterAlternative,
  GradedMarketDetail,
  LogMarketKey,
  LogMatch,
  MarketActual,
  MarketPrediction,
  ScoreResult,
  TeamSideStats,
} from "./types";

function bothSet(a?: number, b?: number): boolean {
  return a != null && b != null && Number.isFinite(a) && Number.isFinite(b);
}

function sumSide(
  home: TeamSideStats | undefined,
  away: TeamSideStats | undefined,
  field: keyof TeamSideStats
): number | null {
  const h = home?.[field];
  const a = away?.[field];
  if (h == null || a == null || !Number.isFinite(h) || !Number.isFinite(a)) return null;
  return h + a;
}

/** Derive market actuals from raw facts — no predictions gate. */
export function deriveActualsFromFacts(
  match: LogMatch
): Partial<Record<LogMarketKey, MarketActual>> {
  const out: Partial<Record<LogMarketKey, MarketActual>> = {};
  const ts = match.teamStats;
  if (!ts) return out;

  const hg = ts.home?.goals;
  const ag = ts.away?.goals;
  if (bothSet(hg, ag)) {
    const result = ftResult(hg!, ag!);
    out["1x2"] = { actual: result };
    out.btts = { actual: hg! > 0 && ag! > 0 ? "yes" : "no" };
    out.home_goals_ou = { actual: hg! };
    out.away_goals_ou = { actual: ag! };
    out.double_chance = {
      actual: doubleChanceActual(result, match.predictions.double_chance?.prediction),
    };
  }

  const hth = ts.home?.firstHalfGoals;
  const ath = ts.away?.firstHalfGoals;
  if (bothSet(hth, ath) && bothSet(hg, ag)) {
    const htRes = ftResult(hth!, ath!);
    out.ht_1x2 = { actual: htRes };
    const g1 = hth! + ath!;
    const g2 = hg! - hth! + (ag! - ath!);
    out.more_goals_half = {
      actual: g1 > g2 ? "first_half" : g2 > g1 ? "second_half" : "equal",
    };
    const draw1h = hth === ath;
    const draw2h = hg! - hth! === ag! - ath!;
    out.draw_one_half = { actual: draw1h || draw2h ? "yes" : "no" };
    out.win_one_half = {
      actual: winOneHalfActual(
        hth!,
        ath!,
        hg!,
        ag!,
        match.predictions.win_one_half?.prediction
      ),
    };
  } else if (bothSet(hth, ath)) {
    out.ht_1x2 = { actual: ftResult(hth!, ath!) };
  } else if (ts.firstHalfResult) {
    out.ht_1x2 = { actual: ts.firstHalfResult };
  }

  const sumFields: Array<{ field: keyof TeamSideStats; market: LogMarketKey }> = [
    { field: "totalShots", market: "shots_ou" },
    { field: "shotsOnTarget", market: "sot_ou" },
    { field: "corners", market: "corners_ou" },
    { field: "throwIns", market: "throw_ins_ou" },
    { field: "offsides", market: "offsides_ou" },
  ];
  for (const { field, market } of sumFields) {
    const total = sumSide(ts.home, ts.away, field);
    if (total != null) out[market] = { actual: total };
  }
  if (ts.home?.totalShots != null && Number.isFinite(ts.home.totalShots)) {
    out.home_shots_ou = { actual: ts.home.totalShots };
  }
  if (ts.away?.totalShots != null && Number.isFinite(ts.away.totalShots)) {
    out.away_shots_ou = { actual: ts.away.totalShots };
  }
  if (ts.home?.shotsOnTarget != null && Number.isFinite(ts.home.shotsOnTarget)) {
    out.home_sot_ou = { actual: ts.home.shotsOnTarget };
  }
  if (ts.away?.shotsOnTarget != null && Number.isFinite(ts.away.shotsOnTarget)) {
    out.away_sot_ou = { actual: ts.away.shotsOnTarget };
  }

  return out;
}

function formatActual(actual: string | number): string {
  return String(actual);
}

export function explainMarketGrade(
  key: LogMarketKey,
  prediction: string,
  line: number | undefined,
  actual: string | number | undefined,
  result: ScoreResult
): string {
  const label = LOG_MARKET_MAP[key]?.label ?? key;
  if (result === "void") {
    return `Void: ${label} cannot be graded (missing required stats).`;
  }
  if (result == null) {
    return `Pending: ${label} not yet graded.`;
  }
  if (actual == null) {
    return `Void: no actual for ${label}.`;
  }
  const predDesc =
    line != null ? `${prediction} ${line}` : prediction;
  if (result === "correct") {
    return `Correct: picked ${predDesc}; actual ${formatActual(actual)}.`;
  }
  if (result === "push") {
    return `Push: actual ${formatActual(actual)} equals line ${line}.`;
  }
  if (key === "btts" && prediction === "yes" && actual === "no") {
    return "Wrong: needed both teams to score; at least one team scored 0.";
  }
  if (key === "btts" && prediction === "no" && actual === "yes") {
    return "Wrong: picked BTTS No but both teams scored.";
  }
  return `Wrong: picked ${predDesc}; actual ${formatActual(actual)}.`;
}

function voidAllSelected(match: LogMatch, reason: string): LogMatch {
  const scored: Partial<Record<LogMarketKey, ScoreResult>> = {};
  const silentGrades: Partial<Record<LogMarketKey, GradedMarketDetail>> = {};
  for (const key of Object.keys(match.predictions) as LogMarketKey[]) {
    scored[key] = "void";
    silentGrades[key] = { result: "void", reason };
  }
  const primaryGrade: GradedMarketDetail = { result: "void", reason };
  return {
    ...match,
    scored,
    silentGrades,
    primaryGrade,
    altGrade: match.altGrade
      ? { ...match.altGrade, result: "void", reason }
      : undefined,
  };
}

function gradePick(
  key: LogMarketKey,
  pred: MarketPrediction,
  actual: string | number | undefined
): GradedMarketDetail {
  if (actual == null) {
    return {
      result: "void",
      reason: explainMarketGrade(key, pred.prediction, pred.line, undefined, "void"),
    };
  }
  const result = scoreMarket(key, pred.prediction, pred.line, actual) ?? "void";
  return {
    result,
    actual,
    reason: explainMarketGrade(key, pred.prediction, pred.line, actual, result),
  };
}

export function gradeFrozenAlternative(
  match: LogMatch,
  alt: FrozenBetterAlternative | null | undefined,
  derivedActuals?: Partial<Record<LogMarketKey, MarketActual>>
): (GradedMarketDetail & { marketLabel: string; predictionLabel: string }) | undefined {
  if (!alt?.prediction) return undefined;
  const derived = derivedActuals ?? deriveActualsFromFacts(match);
  if (match.teamStats?.abnormalMatch) {
    return {
      result: "void",
      reason: "Void: abnormal match flagged.",
      marketLabel: alt.marketLabel,
      predictionLabel: alt.predictionLabel,
    };
  }
  const actual = derived[alt.marketKey]?.actual;
  const detail = gradePick(
    alt.marketKey,
    { prediction: alt.prediction, line: alt.line, confidence: 0 },
    actual
  );
  return {
    ...detail,
    marketLabel: alt.marketLabel,
    predictionLabel: alt.predictionLabel,
  };
}

export function formatAltWouldHaveWonNote(
  match: LogMatch,
  primary: GradedMarketDetail | undefined,
  alt: (GradedMarketDetail & { marketLabel: string; predictionLabel: string }) | undefined
): string | null {
  if (!primary || !alt) return null;
  if (primary.result !== "wrong" || alt.result !== "correct") return null;
  const key = singleMarketKey(match);
  const selectedLabel = key
    ? LOG_MARKET_MAP[key]?.label ?? key
    : match.comboPick?.comboId?.replace(/_/g, " ") ?? "Selected";
  return `Selected ${selectedLabel} ✗, but suggested ${alt.marketLabel} (${alt.predictionLabel}) would have won ✓`;
}

export interface GradeMatchOptions {
  betterAlternative?: FrozenBetterAlternative | null;
}

/** Full facts → actuals → scored + silentGrades + primaryGrade. */
export function gradeMatchFromFacts(
  match: LogMatch,
  options: GradeMatchOptions = {}
): LogMatch {
  if (match.teamStats?.abnormalMatch) {
    const voided = voidAllSelected(match, "Void: abnormal match flagged.");
    if (options.betterAlternative) {
      const altGrade = gradeFrozenAlternative(voided, options.betterAlternative);
      return { ...voided, altGrade };
    }
    return voided;
  }

  const derived = deriveActualsFromFacts(match);
  const actualResults: Partial<Record<LogMarketKey, MarketActual>> = {
    ...match.actualResults,
    ...derived,
  };

  const scored: Partial<Record<LogMarketKey, ScoreResult>> = {};
  const silentGrades: Partial<Record<LogMarketKey, GradedMarketDetail>> = {};

  for (const def of LOG_MARKETS) {
    const key = def.key;
    const actual = derived[key]?.actual ?? actualResults[key]?.actual;
    if (actual != null) {
      silentGrades[key] = {
        result: null,
        actual,
        reason: `Outcome: ${formatActual(actual)}`,
      };
    }
    const pred = match.predictions[key];
    if (!pred) continue;
    const detail = gradePick(key, pred, actual);
    scored[key] = detail.result;
    silentGrades[key] = detail;
  }

  let primaryGrade: GradedMarketDetail | undefined;
  const mode = resolveMarketMode(match);

  if (mode === "combined" && match.comboPick?.comboId) {
    const comboResult = scoreComboLeg(
      match.comboPick.comboId,
      actualResults,
      match.teamStats
    );
    const result = comboResult === null ? "void" : comboResult;
    primaryGrade = {
      result,
      reason: explainComboResult(
        match.comboPick.comboId,
        result,
        actualResults,
        match.teamStats
      ),
    };
  } else {
    const key = singleMarketKey(match);
    if (key && match.predictions[key]) {
      primaryGrade = silentGrades[key] ?? {
        result: "void",
        reason: explainMarketGrade(
          key,
          match.predictions[key]!.prediction,
          match.predictions[key]!.line,
          undefined,
          "void"
        ),
      };
    }
  }

  const withGrades: LogMatch = {
    ...match,
    actualResults,
    scored,
    silentGrades,
    primaryGrade,
  };

  const altGrade = gradeFrozenAlternative(
    withGrades,
    options.betterAlternative,
    derived
  );
  if (altGrade) {
    return { ...withGrades, altGrade };
  }
  const { altGrade: _drop, ...rest } = withGrades;
  void _drop;
  return rest;
}
