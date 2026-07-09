import { impliedProbability, isValidOdds, oddsToBand } from "./odds-bands";
import {
  getGlobalMarketRate,
  getMarketRate,
  getOddsBandRate,
  getTeamPickRate,
  type RecommendationContext,
} from "./recommendation-context";
import {
  COLD_START_CONFIDENCE_FACTOR,
  isHighVarianceMarket,
  MIN_SAMPLE_FOR_ACTION,
  MIN_TEAM_SAMPLE,
} from "./recommendation-config";
import { getClubComparisonRate } from "./club-record-insights";
import { isValueBet, VALUE_BET_MARGIN } from "./systematic-odds";
import type { LogMarketKey, LogMatch, MarketPrediction } from "./types";

export interface ConfidenceScenario {
  label: string;
  pct: number | null;
  weight: number;
  sample: number;
  used: boolean;
}

export interface AdjustedConfidenceResult {
  original: number;
  adjusted: number;
  scenarios: ConfidenceScenario[];
  breakdown: string;
}

const WEIGHTS = {
  leagueMarket: 0.24,
  globalMarket: 0.1,
  oddsBand: 0.22,
  teamPick: 0.14,
  clubProfile: 0.12,
  implied: 0.1,
  recentForm: 0.08,
} as const;

function clamp(n: number, min = 5, max = 95): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function overallAccuracyPct(ctx: RecommendationContext): number | null {
  const total = ctx.analysis.totalScored;
  if (total < MIN_SAMPLE_FOR_ACTION) return null;
  let correct = 0;
  let wrong = 0;
  for (const stats of Object.values(ctx.analysis.marketAccuracy)) {
    if (!stats) continue;
    correct += stats.correct;
    wrong += stats.wrong;
  }
  const denom = correct + wrong;
  return denom > 0 ? Math.round((correct / denom) * 100) : null;
}

export function computeAdjustedConfidence(
  ctx: RecommendationContext,
  match: LogMatch,
  marketKey: LogMarketKey,
  pick: MarketPrediction,
  userOriginal: MarketPrediction
): AdjustedConfidenceResult {
  const leagueRate = getMarketRate(ctx, ctx.league, marketKey);
  const globalRate = getGlobalMarketRate(ctx, marketKey);
  const bandRate =
    pick.odds != null && isValidOdds(pick.odds)
      ? getOddsBandRate(ctx, oddsToBand(pick.odds))
      : { pct: null, sample: 0, lowSample: true };
  const teamRate = getTeamPickRate(
    ctx,
    match.homeTeam,
    match.awayTeam,
    marketKey,
    pick.prediction
  );
  const impliedPct =
    pick.odds != null && isValidOdds(pick.odds)
      ? Math.round(impliedProbability(pick.odds) * 100)
      : null;
  const recent = ctx.analysis.recentForm;
  const recentSample = recent.correct + recent.wrong;
  const recentPct =
    recentSample >= MIN_SAMPLE_FOR_ACTION && recent.pct != null ? recent.pct : null;

  const clubCmp = getClubComparisonRate(ctx, match, marketKey);
  const clubPct = clubCmp.lowSample ? null : clubCmp.pct;
  const clubSample = clubCmp.sample;

  const scenarios: ConfidenceScenario[] = [
    {
      label: "League market",
      pct: leagueRate.pct,
      weight: WEIGHTS.leagueMarket,
      sample: leagueRate.sample,
      used: false,
    },
    {
      label: "Global market",
      pct: globalRate.pct,
      weight: WEIGHTS.globalMarket,
      sample: globalRate.sample,
      used: false,
    },
    {
      label: "Odds band",
      pct: bandRate.pct,
      weight: WEIGHTS.oddsBand,
      sample: bandRate.sample,
      used: false,
    },
    {
      label: "Team trend",
      pct: teamRate.pct,
      weight: WEIGHTS.teamPick,
      sample: teamRate.sample,
      used: false,
    },
    {
      label: "Club capacity",
      pct: clubPct,
      weight: WEIGHTS.clubProfile,
      sample: clubSample,
      used: false,
    },
    {
      label: "Implied odds",
      pct: impliedPct,
      weight: WEIGHTS.implied,
      sample: pick.odds != null ? 1 : 0,
      used: false,
    },
    {
      label: "Recent form",
      pct: recentPct,
      weight: WEIGHTS.recentForm,
      sample: recentSample,
      used: false,
    },
  ];

  let weightedSum = 0;
  let totalWeight = 0;

  for (const s of scenarios) {
    const minSample =
      s.label === "Implied odds"
        ? 1
        : s.label === "Team trend"
          ? MIN_TEAM_SAMPLE
          : s.label === "Club capacity"
            ? MIN_TEAM_SAMPLE
            : MIN_SAMPLE_FOR_ACTION;
    if (s.pct == null || s.sample < minSample) continue;
    s.used = true;
    weightedSum += s.pct * s.weight;
    totalWeight += s.weight;
  }

  let adjusted: number;
  if (totalWeight > 0) {
    adjusted = weightedSum / totalWeight;
  } else if (impliedPct != null) {
    adjusted = userOriginal.confidence * 0.35 + impliedPct * 0.65;
  } else {
    adjusted = userOriginal.confidence * COLD_START_CONFIDENCE_FACTOR;
  }

  if (isHighVarianceMarket(marketKey)) {
    adjusted -= 6;
  }

  if (pick.odds != null && isValidOdds(pick.odds)) {
    if (!isValueBet(userOriginal.confidence, pick.odds) && impliedPct != null) {
      const valueCeiling = impliedPct + VALUE_BET_MARGIN * 100;
      adjusted = Math.min(adjusted, valueCeiling);
    }
  }

  const hiAcc = ctx.analysis.highConfidenceAccuracy;
  const hiSample = hiAcc.correct + hiAcc.wrong;
  if (
    userOriginal.confidence > 70 &&
    hiSample >= MIN_SAMPLE_FOR_ACTION &&
    hiAcc.pct != null &&
    hiAcc.pct < userOriginal.confidence
  ) {
    adjusted = adjusted * 0.7 + hiAcc.pct * 0.3;
  }

  const overall = overallAccuracyPct(ctx);
  if (overall != null && adjusted > overall + 15) {
    adjusted = (adjusted + overall) / 2;
  }

  adjusted = Math.min(adjusted, userOriginal.confidence);
  adjusted = clamp(adjusted);

  const usedParts = scenarios
    .filter((s) => s.used && s.pct != null)
    .map((s) => `${s.label} ${s.pct}%`);

  const breakdown =
    usedParts.length > 0
      ? `Blended from: ${usedParts.join(", ")}.`
      : impliedPct != null
        ? `Limited history — blended your ${userOriginal.confidence}% with ${impliedPct}% implied.`
        : `Limited history — scaled from your ${userOriginal.confidence}%.`;

  return {
    original: userOriginal.confidence,
    adjusted,
    scenarios,
    breakdown,
  };
}

export function applyConfidenceToPick(
  pick: MarketPrediction,
  userOriginal: MarketPrediction,
  ctx: RecommendationContext,
  match: LogMatch,
  marketKey: LogMarketKey
): MarketPrediction & { confidenceBreakdown: string } {
  const result = computeAdjustedConfidence(ctx, match, marketKey, pick, userOriginal);
  return {
    ...pick,
    confidence: result.adjusted,
    confidenceBreakdown: result.breakdown,
  };
}
