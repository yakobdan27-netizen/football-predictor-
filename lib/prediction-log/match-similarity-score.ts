import { impliedProbability, isValidOdds, oddsToBand } from "./odds-bands";
import {
  fineBucketStats,
  type FineOddsBucketStats,
} from "./odds-bucket-analysis";
import {
  getGlobalMarketRate,
  getMarketRate,
  getOddsBandRate,
  getTeamPickRate,
  type RecommendationContext,
} from "./recommendation-context";
import { getClubMarketHitRateFromContext } from "./club-record-insights";
import { MIN_SAMPLE_FOR_ACTION, MIN_TEAM_SAMPLE } from "./recommendation-config";
import { isValueBet } from "./systematic-odds";
import type {
  EvidencePoint,
  LogMarketKey,
  LogMatch,
  RecommendedPick,
} from "./types";

const WEIGHTS = {
  leagueMarket: 0.27,
  oddsBucket: 0.22,
  teamPick: 0.22,
  clubProfile: 0.12,
  leagueContext: 0.07,
  valueBet: 0.1,
} as const;

function evidence(label: string, pct: number | null, sample: number): EvidencePoint {
  const value =
    pct != null && sample > 0 ? `${pct}% (${sample} picks)` : sample > 0 ? `${sample} picks` : "No data";
  return { label, value, pct, sample };
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function computeMatchSimilarity(
  ctx: RecommendationContext,
  league: string,
  match: LogMatch,
  marketKey: LogMarketKey,
  pick: RecommendedPick,
  fineBuckets: Map<string, FineOddsBucketStats>
): { score: number; evidence: EvidencePoint[]; oddsSuccessRate: number | null; hasDirectHistory: boolean } {
  const points: EvidencePoint[] = [];
  let weightedSum = 0;
  let totalWeight = 0;
  let hasDirectHistory = false;

  const leagueRate = getMarketRate(ctx, league, marketKey);
  if (leagueRate.pct != null && leagueRate.sample >= MIN_SAMPLE_FOR_ACTION) {
    weightedSum += leagueRate.pct * WEIGHTS.leagueMarket;
    totalWeight += WEIGHTS.leagueMarket;
    hasDirectHistory = true;
    points.push(evidence(`League ${marketKey}`, leagueRate.pct, leagueRate.sample));
  } else {
    const globalRate = getGlobalMarketRate(ctx, marketKey);
    if (globalRate.pct != null && globalRate.sample >= MIN_SAMPLE_FOR_ACTION) {
      weightedSum += globalRate.pct * WEIGHTS.leagueMarket;
      totalWeight += WEIGHTS.leagueMarket;
      hasDirectHistory = true;
      points.push(evidence(`Global ${marketKey}`, globalRate.pct, globalRate.sample));
    }
  }

  let oddsSuccessRate: number | null = null;
  if (pick.odds != null && isValidOdds(pick.odds)) {
    const fine = fineBucketStats(fineBuckets, pick.odds);
    if (fine?.pct != null && fine.sample >= MIN_SAMPLE_FOR_ACTION) {
      oddsSuccessRate = fine.pct;
      weightedSum += fine.pct * WEIGHTS.oddsBucket;
      totalWeight += WEIGHTS.oddsBucket;
      hasDirectHistory = true;
      points.push(
        evidence(`Odds ${fine.bucket}`, fine.pct, fine.sample)
      );
    } else {
      const bandRate = getOddsBandRate(ctx, oddsToBand(pick.odds));
      if (bandRate.pct != null && bandRate.sample >= MIN_SAMPLE_FOR_ACTION) {
        oddsSuccessRate = bandRate.pct;
        weightedSum += bandRate.pct * WEIGHTS.oddsBucket;
        totalWeight += WEIGHTS.oddsBucket;
        hasDirectHistory = true;
        points.push(evidence(`Odds band ${oddsToBand(pick.odds)}`, bandRate.pct, bandRate.sample));
      }
    }
  }

  const teamRate = getTeamPickRate(
    ctx,
    match.homeTeam,
    match.awayTeam,
    marketKey,
    pick.prediction
  );
  if (teamRate.pct != null && teamRate.sample >= MIN_TEAM_SAMPLE) {
    weightedSum += teamRate.pct * WEIGHTS.teamPick;
    totalWeight += WEIGHTS.teamPick;
    hasDirectHistory = true;
    points.push(evidence("Team trend", teamRate.pct, teamRate.sample));
  }

  const homeClub = getClubMarketHitRateFromContext(
    ctx,
    match.homeTeam,
    marketKey,
    "home",
    match.homeClubId
  );
  const awayClub = getClubMarketHitRateFromContext(
    ctx,
    match.awayTeam,
    marketKey,
    "away",
    match.awayClubId
  );
  const clubRates = [homeClub, awayClub].filter((r) => !r.lowSample && r.pct != null);
  if (clubRates.length > 0) {
    const avgPct = Math.round(
      clubRates.reduce((s, r) => s + (r.pct ?? 0), 0) / clubRates.length
    );
    const totalSample = clubRates.reduce((s, r) => s + r.sample, 0);
    weightedSum += avgPct * WEIGHTS.clubProfile;
    totalWeight += WEIGHTS.clubProfile;
    hasDirectHistory = true;
    points.push(evidence("Club capacity", avgPct, totalSample));
  }

  const leagueMarkets = ctx.analysis.leagueAccuracy[league];
  if (leagueMarkets) {
    const scored = Object.values(leagueMarkets).reduce(
      (acc, s) => acc + (s?.correct ?? 0) + (s?.wrong ?? 0),
      0
    );
    if (scored >= MIN_SAMPLE_FOR_ACTION) {
      let correct = 0;
      let wrong = 0;
      for (const s of Object.values(leagueMarkets)) {
        if (!s) continue;
        correct += s.correct;
        wrong += s.wrong;
      }
      const pct = Math.round((correct / (correct + wrong)) * 100);
      weightedSum += pct * WEIGHTS.leagueContext;
      totalWeight += WEIGHTS.leagueContext;
      points.push(evidence(`League ${league}`, pct, correct + wrong));
    }
  }

  if (pick.odds != null && isValidOdds(pick.odds)) {
    const valueScore = isValueBet(pick.confidence, pick.odds) ? 75 : 35;
    weightedSum += valueScore * WEIGHTS.valueBet;
    totalWeight += WEIGHTS.valueBet;
    const implied = Math.round(impliedProbability(pick.odds) * 100);
    points.push(
      evidence(
        "Value margin",
        isValueBet(pick.confidence, pick.odds) ? pick.confidence : implied,
        1
      )
    );
  }

  let score: number;
  if (totalWeight > 0) {
    score = weightedSum / totalWeight;
  } else if (pick.odds != null && isValidOdds(pick.odds)) {
    const implied = impliedProbability(pick.odds) * 100;
    score = Math.min(55, pick.confidence * 0.7 + implied * 0.3);
    points.push(evidence("Limited history", null, 0));
  } else {
    score = Math.min(55, pick.confidence * 0.85);
    points.push(evidence("Limited history", null, 0));
  }

  return {
    score: clampScore(score),
    evidence: points,
    oddsSuccessRate,
    hasDirectHistory,
  };
}

export function computeCombinedScore(
  similarityScore: number,
  oddsSuccessRate: number | null
): number {
  const oddsPart = oddsSuccessRate ?? similarityScore;
  return (
    Math.round(
      (similarityScore * 0.6 + oddsPart * 0.4) * 100
    ) / 100
  );
}
