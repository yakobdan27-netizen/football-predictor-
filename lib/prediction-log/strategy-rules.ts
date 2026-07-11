/**
 * Placement-time bankroll / staking / stop-loss helpers (strategy layer).
 * Soft enforcement only — never hard-blocks saves.
 */

import {
  ABSOLUTE_STAKE_CAP_PCT,
} from "./recommendation-config";
import { isValidOdds } from "./odds-bands";
import { isValueBet, valueGapPercent } from "./systematic-odds";
import { resolveMarketMode, singleMarketKey } from "./match-entry-helpers";
import { scoreComboLeg } from "./combo-scoring";
import type {
  BankrollStrategySettings,
  LogMatch,
  PredictionBatch,
  RecommendationTier,
  ScoreResult,
} from "./types";

export type StrategyFlag =
  | "below_value"
  | "over_risk_cap"
  | "over_absolute_cap"
  | "stop_loss_active"
  | "no_bankroll";

export interface SuggestStakeInput {
  settings: BankrollStrategySettings;
  /** Estimated win probability 0–100. */
  pSignal: number | null;
  odds: number | null;
  tier?: RecommendationTier;
}

export interface SuggestStakeResult {
  suggested: number | null;
  reason: string;
}

export interface StopLossStatus {
  stopLossActive: boolean;
  reason: string | null;
  suggestedAction: "pause" | null;
  consecutiveLosses: number;
  todayPnL: number;
  todayDrawdownPct: number | null;
  rollingPnL: number;
  rollingDrawdownPct: number | null;
}

export interface BankrollHealth {
  bankroll: number | null;
  startingBankroll: number | null;
  ratioToStart: number | null;
  thresholdsHit: Array<75 | 60 | 50>;
  maxStake: number | null;
  messages: string[];
}

export interface PlacementAlert {
  flags: StrategyFlag[];
  messages: string[];
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Suggested stake: flat % or fractional Kelly, × tier mult, capped at maxRisk and 2% bankroll.
 */
export function suggestStake(input: SuggestStakeInput): SuggestStakeResult {
  const { settings, pSignal, odds, tier = "balanced" } = input;
  const bankroll = settings.bankroll;
  if (bankroll == null || bankroll <= 0) {
    return { suggested: null, reason: "Set bankroll in Settings to get stake suggestions." };
  }

  const maxRisk = Math.min(settings.maxRiskPctPerBet, ABSOLUTE_STAKE_CAP_PCT);
  const hardCap = roundMoney((bankroll * maxRisk) / 100);
  const absoluteCap = roundMoney((bankroll * ABSOLUTE_STAKE_CAP_PCT) / 100);
  const cap = Math.min(hardCap, absoluteCap);

  const mult = settings.tierStakeMult[tier] ?? 1;
  let base = 0;
  let reason = "";

  const kellyFraction =
    settings.stakingMode === "quarter_kelly"
      ? 0.25
      : settings.stakingMode === "half_kelly"
        ? 0.5
        : null;

  if (kellyFraction != null) {
    if (pSignal == null || odds == null || !(odds > 1)) {
      base = (bankroll * settings.flatStakePct) / 100;
      reason = `${kellyFraction === 0.25 ? "Quarter" : "Half"}-Kelly needs prob + odds; fell back to flat %.`;
    } else {
      const p = Math.min(0.99, Math.max(0.01, pSignal / 100));
      const b = odds - 1;
      const q = 1 - p;
      const f = b > 0 ? (b * p - q) / b : 0;
      const frac = Math.max(0, f * kellyFraction);
      base = bankroll * frac;
      reason = `${kellyFraction === 0.25 ? "Quarter" : "Half"}-Kelly ${(frac * 100).toFixed(1)}% of bankroll.`;
    }
  } else {
    base = (bankroll * settings.flatStakePct) / 100;
    reason = `Flat ${settings.flatStakePct}% of bankroll.`;
  }

  let suggested = roundMoney(base * mult);
  if (suggested > cap) {
    suggested = cap;
    reason += ` Capped at ${maxRisk}% risk.`;
  }
  if (suggested <= 0) {
    return { suggested: null, reason: "No positive edge for Kelly; stake not suggested." };
  }
  return { suggested, reason };
}

export function maxRecommendedStake(settings: BankrollStrategySettings): number | null {
  const bankroll = settings.bankroll;
  if (bankroll == null || bankroll <= 0) return null;
  const pct = Math.min(settings.maxRiskPctPerBet, ABSOLUTE_STAKE_CAP_PCT);
  return roundMoney((bankroll * pct) / 100);
}

function daysBefore(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function evaluateStopLoss(
  batches: PredictionBatch[],
  settings: BankrollStrategySettings,
  todayIso = new Date().toISOString().slice(0, 10)
): StopLossStatus {
  const settledLegs: Array<{ date: string; result: "correct" | "wrong"; pnl: number }> =
    [];

  for (const batch of batches) {
    for (const m of batch.matches) {
      const r = primaryLegResult(m);
      if (r !== "correct" && r !== "wrong") continue;
      const pnl = matchPnL(m) ?? (r === "wrong" ? -(m.stake ?? 0) : 0);
      settledLegs.push({ date: batch.date, result: r, pnl });
    }
  }

  settledLegs.sort((a, b) => a.date.localeCompare(b.date));

  let consecutiveLosses = 0;
  for (let i = settledLegs.length - 1; i >= 0; i--) {
    if (settledLegs[i]!.result === "wrong") consecutiveLosses++;
    else break;
  }

  let todayPnL = 0;
  for (const leg of settledLegs) {
    if (leg.date === todayIso) todayPnL += leg.pnl;
  }
  todayPnL = roundMoney(todayPnL);

  const rollingFrom = daysBefore(todayIso, settings.stopLossRollingDays ?? 30);
  let rollingPnL = 0;
  for (const leg of settledLegs) {
    if (leg.date >= rollingFrom && leg.date <= todayIso) rollingPnL += leg.pnl;
  }
  rollingPnL = roundMoney(rollingPnL);

  const bankroll = settings.bankroll;
  const todayDrawdownPct =
    bankroll != null && bankroll > 0 && todayPnL < 0
      ? Math.round((-todayPnL / bankroll) * 1000) / 10
      : bankroll != null && bankroll > 0
        ? 0
        : null;

  const rollingDrawdownPct =
    bankroll != null && bankroll > 0 && rollingPnL < 0
      ? Math.round((-rollingPnL / bankroll) * 1000) / 10
      : bankroll != null && bankroll > 0
        ? 0
        : null;

  const hitConsecutive =
    consecutiveLosses >= settings.stopLossConsecutiveLosses;
  const hitDaily =
    todayDrawdownPct != null &&
    todayDrawdownPct >= settings.stopLossDailyDrawdownPct;
  const hitRolling =
    rollingDrawdownPct != null &&
    rollingDrawdownPct >= (settings.stopLossRollingDrawdownPct ?? 25);

  if (!settings.strategyAlertsEnabled) {
    return {
      stopLossActive: false,
      reason: null,
      suggestedAction: null,
      consecutiveLosses,
      todayPnL,
      todayDrawdownPct,
      rollingPnL,
      rollingDrawdownPct,
    };
  }

  if (hitConsecutive || hitDaily || hitRolling) {
    const parts: string[] = [];
    if (hitConsecutive) {
      parts.push(
        `${consecutiveLosses} consecutive losses (limit ${settings.stopLossConsecutiveLosses})`
      );
    }
    if (hitDaily) {
      parts.push(
        `today drawdown ${todayDrawdownPct}% (limit ${settings.stopLossDailyDrawdownPct}%)`
      );
    }
    if (hitRolling) {
      parts.push(
        `${settings.stopLossRollingDays}-day drawdown ${rollingDrawdownPct}% (limit ${settings.stopLossRollingDrawdownPct}%)`
      );
    }
    return {
      stopLossActive: true,
      reason: parts.join("; "),
      suggestedAction: "pause",
      consecutiveLosses,
      todayPnL,
      todayDrawdownPct,
      rollingPnL,
      rollingDrawdownPct,
    };
  }

  return {
    stopLossActive: false,
    reason: null,
    suggestedAction: null,
    consecutiveLosses,
    todayPnL,
    todayDrawdownPct,
    rollingPnL,
    rollingDrawdownPct,
  };
}

export function evaluateBankrollHealth(
  settings: BankrollStrategySettings
): BankrollHealth {
  const bankroll = settings.bankroll;
  const start = settings.startingBankroll ?? settings.bankroll;
  const messages: string[] = [];
  const thresholdsHit: Array<75 | 60 | 50> = [];
  let ratioToStart: number | null = null;

  if (bankroll != null && start != null && start > 0) {
    ratioToStart = Math.round((bankroll / start) * 1000) / 10;
    const pctOfStart = (bankroll / start) * 100;
    if (pctOfStart <= 50) {
      thresholdsHit.push(50);
      messages.push("Bankroll at or below 50% of starting amount — pause and review.");
    } else if (pctOfStart <= 60) {
      thresholdsHit.push(60);
      messages.push("Bankroll at or below 60% of starting amount.");
    } else if (pctOfStart <= 75) {
      thresholdsHit.push(75);
      messages.push("Bankroll at or below 75% of starting amount.");
    }
  }

  return {
    bankroll,
    startingBankroll: start,
    ratioToStart,
    thresholdsHit,
    maxStake: maxRecommendedStake(settings),
    messages,
  };
}

export function matchLoggedOdds(match: LogMatch): number | null {
  const mode = resolveMarketMode(match);
  if (mode === "combined") {
    const o = match.comboPick?.odds;
    return o != null && isValidOdds(o) ? o : o != null && o > 1 ? o : null;
  }
  const key = singleMarketKey(match);
  if (!key) return null;
  const o = match.predictions[key]?.odds;
  return o != null && Number.isFinite(o) && o > 1 ? o : null;
}

export function matchConfidencePct(match: LogMatch): number | null {
  const mode = resolveMarketMode(match);
  if (mode === "combined") {
    const p = match.comboPick?.systemProbability;
    return p != null && Number.isFinite(p) ? p : null;
  }
  const key = singleMarketKey(match);
  if (!key) return null;
  const c = match.predictions[key]?.confidence;
  return c != null && Number.isFinite(c) ? c : null;
}

export function primaryLegResult(match: LogMatch): ScoreResult {
  if (match.primaryGrade?.result != null) return match.primaryGrade.result;
  const mode = resolveMarketMode(match);
  if (mode === "combined" && match.comboPick?.comboId) {
    return (
      scoreComboLeg(match.comboPick.comboId, match.actualResults, match.teamStats) ??
      null
    );
  }
  const key = singleMarketKey(match);
  if (!key) return null;
  return match.scored[key] ?? null;
}

/** Unit profit for a settled leg; null if missing stake/odds or not graded hit/miss. */
export function matchPnL(match: LogMatch): number | null {
  const stake = match.stake;
  const odds = matchLoggedOdds(match);
  if (stake == null || !Number.isFinite(stake) || stake <= 0) return null;
  if (odds == null) return null;
  const result = primaryLegResult(match);
  if (result === "correct") return roundMoney(stake * (odds - 1));
  if (result === "wrong") return roundMoney(-stake);
  return null;
}

export function batchPnL(matches: LogMatch[]): {
  totalPnL: number | null;
  staked: number;
  n: number;
  roiPct: number | null;
} {
  let totalPnL = 0;
  let staked = 0;
  let n = 0;
  for (const m of matches) {
    const pnl = matchPnL(m);
    if (pnl == null) continue;
    totalPnL += pnl;
    staked += m.stake ?? 0;
    n++;
  }
  if (n === 0) {
    return { totalPnL: null, staked: 0, n: 0, roiPct: null };
  }
  return {
    totalPnL: roundMoney(totalPnL),
    staked: roundMoney(staked),
    n,
    roiPct: staked > 0 ? Math.round((totalPnL / staked) * 1000) / 10 : null,
  };
}

export function evaluatePlacementAlerts(opts: {
  match: LogMatch;
  settings: BankrollStrategySettings;
  pSignal: number | null;
  stopLoss: StopLossStatus;
  tier?: RecommendationTier;
}): PlacementAlert {
  const flags: StrategyFlag[] = [];
  const messages: string[] = [];
  const { match, settings, pSignal, stopLoss, tier = "balanced" } = opts;

  if (!settings.strategyAlertsEnabled) {
    return { flags, messages };
  }

  if (settings.bankroll == null || settings.bankroll <= 0) {
    flags.push("no_bankroll");
    messages.push("Bankroll not set — stake suggestions unavailable.");
  }

  const odds = matchLoggedOdds(match);
  const conf = pSignal ?? matchConfidencePct(match);
  if (odds != null && conf != null && !isValueBet(conf, odds)) {
    flags.push("below_value");
    const gap = valueGapPercent(conf, odds);
    messages.push(
      gap != null
        ? `Below value margin (edge ${gap}%; need ≥8%).`
        : "Below 8% value margin vs implied odds."
    );
  }

  const stake = match.stake;
  const bankroll = settings.bankroll;
  if (stake != null && bankroll != null && bankroll > 0 && stake > 0) {
    const pct = (stake / bankroll) * 100;
    if (pct > settings.maxRiskPctPerBet) {
      flags.push("over_risk_cap");
      messages.push(
        `Stake ${pct.toFixed(1)}% exceeds max risk ${settings.maxRiskPctPerBet}% per bet.`
      );
    }
    if (pct > ABSOLUTE_STAKE_CAP_PCT) {
      flags.push("over_absolute_cap");
      messages.push(`Stake exceeds absolute ${ABSOLUTE_STAKE_CAP_PCT}% bankroll cap.`);
    }
  }

  if (stopLoss.stopLossActive) {
    flags.push("stop_loss_active");
    messages.push(
      `Stop-loss active: ${stopLoss.reason}. Suggested action: pause.`
    );
  }

  void tier;
  return { flags, messages };
}

export function aggregateBatchPlacementAlerts(
  matches: LogMatch[],
  settings: BankrollStrategySettings,
  stopLoss: StopLossStatus,
  pByMatch?: Record<string, number | null>
): PlacementAlert {
  const flagSet = new Set<StrategyFlag>();
  const messages: string[] = [];
  for (const m of matches) {
    const alert = evaluatePlacementAlerts({
      match: m,
      settings,
      pSignal: pByMatch?.[m.id] ?? matchConfidencePct(m),
      stopLoss,
    });
    for (const f of alert.flags) flagSet.add(f);
    for (const msg of alert.messages) {
      if (!messages.includes(msg)) messages.push(msg);
    }
  }
  if (stopLoss.stopLossActive && !flagSet.has("stop_loss_active")) {
    flagSet.add("stop_loss_active");
    messages.unshift(
      `Stop-loss active: ${stopLoss.reason}. Suggested action: pause.`
    );
  }
  return { flags: [...flagSet], messages };
}

export function formatMoney(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

export function tierStakeMultiplier(
  settings: BankrollStrategySettings,
  tier: RecommendationTier | undefined
): number {
  if (!tier) return settings.tierStakeMult.balanced;
  return settings.tierStakeMult[tier] ?? 1;
}

/** Apply tier multiplier to a base suggested stake (reco display). */
export function applyTierToSuggestedStake(
  baseStake: number | null | undefined,
  settings: BankrollStrategySettings,
  tier: RecommendationTier | undefined
): number | null {
  if (baseStake == null || !Number.isFinite(baseStake)) return null;
  const bankroll = settings.bankroll;
  const mult = tierStakeMultiplier(settings, tier);
  let next = roundMoney(baseStake * mult);
  if (bankroll != null && bankroll > 0) {
    const cap = roundMoney(
      (bankroll * Math.min(settings.maxRiskPctPerBet, ABSOLUTE_STAKE_CAP_PCT)) / 100
    );
    next = Math.min(next, cap);
  }
  return next;
}
