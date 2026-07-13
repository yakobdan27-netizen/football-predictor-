import { isValidOdds, oddsToBand } from "./odds-bands";
import { concentrationFromGrid } from "./correct-score-freeze";
import { isInWorstBucket, type FineOddsBucketStats } from "./odds-bucket-analysis";
import {
  computeCombinedScore,
  computeMatchSimilarity,
} from "./match-similarity-score";
import {
  getGlobalMarketRate,
  getMarketRate,
  getOddsBandRate,
  type RecommendationContext,
} from "./recommendation-context";
import {
  HARD_EXCLUDE_WIN_RATE,
  MIN_SAMPLE_FOR_ACTION,
  ODDS_FILTER_BYPASS_WIN_RATE,
  ODDS_FILTER_MAX,
  ODDS_FILTER_MIN,
  RISK_LOW_MAX_ODDS,
  RISK_MEDIUM_MAX_ODDS,
  SCORE_WEIGHT_ACCURACY,
  SCORE_WEIGHT_CONFIDENCE,
  SCORE_WEIGHT_ODDS_BAND,
  SIMILARITY_MIN_THRESHOLD,
} from "./recommendation-config";
import { isClubWeakFromContext } from "./club-record-insights";
import { isValueBet, valueGapPercent } from "./systematic-odds";
import { computeEdgeMetrics } from "./professional-estimator";
import type {
  EvidencePoint,
  LogMarketKey,
  LogMatch,
  RecommendationSettings,
  RecommendedPick,
  RiskLevel,
} from "./types";

export interface ScoredMatchCandidate {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  marketKey: LogMarketKey;
  pick: RecommendedPick;
  riskAdjustedScore: number;
  similarityScore: number;
  combinedScore: number;
  evidence: EvidencePoint[];
  inWorstOddsBucket: boolean;
  marketAccuracyPct: number | null;
  oddsBandWinRate: number | null;
  legOdds: number;
  passesHardFilters: boolean;
  exclusionReason: string | null;
  hasSimilarityHistory: boolean;
  concentrationIndex?: number | null;
}

function marketAccuracyPct(
  ctx: RecommendationContext,
  league: string,
  market: LogMarketKey
): number | null {
  const leagueRate = getMarketRate(ctx, league, market);
  if (!leagueRate.lowSample && leagueRate.pct != null) return leagueRate.pct;
  const globalRate = getGlobalMarketRate(ctx, market);
  if (!globalRate.lowSample && globalRate.pct != null) return globalRate.pct;
  return leagueRate.pct ?? globalRate.pct;
}

function computeRiskScore(
  marketPct: number | null,
  bandPct: number | null,
  confidence: number,
  hasHistory: boolean,
  odds: number
): number {
  if (hasHistory && marketPct != null) {
    const band = bandPct ?? marketPct;
    return (
      marketPct * SCORE_WEIGHT_ACCURACY +
      band * SCORE_WEIGHT_ODDS_BAND +
      confidence * SCORE_WEIGHT_CONFIDENCE
    );
  }
  const valueBonus = isValueBet(confidence, odds)
    ? Math.min(valueGapPercent(confidence, odds) ?? 0, 20)
    : 0;
  return confidence * 0.6 + valueBonus * 0.4;
}

function applyHardFilters(
  pick: RecommendedPick,
  marketKey: LogMarketKey,
  ctx: RecommendationContext,
  league: string,
  settings: RecommendationSettings,
  similarityScore: number,
  hasSimilarityHistory: boolean,
  inWorstOddsBucket: boolean,
  match: LogMatch
): { passes: boolean; reason: string | null } {
  if (pick.action === "remove") {
    return { passes: false, reason: pick.judgment || "Pick removed by revision rules." };
  }

  const odds = pick.odds;
  if (!isValidOdds(odds)) {
    return { passes: false, reason: "Invalid or missing odds." };
  }

  if (hasSimilarityHistory && similarityScore < SIMILARITY_MIN_THRESHOLD) {
    return {
      passes: false,
      reason: `Similarity score ${similarityScore} below minimum ${SIMILARITY_MIN_THRESHOLD}.`,
    };
  }

  if (inWorstOddsBucket) {
    return {
      passes: false,
      reason: `Odds ${odds} fall in a historically weak fine bucket.`,
    };
  }

  const homeWeak = isClubWeakFromContext(ctx, match.homeTeam, marketKey, "home", match.homeClubId);
  const awayWeak = isClubWeakFromContext(ctx, match.awayTeam, marketKey, "away", match.awayClubId);
  if (homeWeak.weak || awayWeak.weak) {
    return {
      passes: false,
      reason: homeWeak.reason ?? awayWeak.reason ?? "Club profile indicates high risk for this market.",
    };
  }

  const marketRate = getMarketRate(ctx, league, marketKey);
  const effectiveRate = !marketRate.lowSample ? marketRate : getGlobalMarketRate(ctx, marketKey);
  if (
    !effectiveRate.lowSample &&
    effectiveRate.pct != null &&
    effectiveRate.sample >= MIN_SAMPLE_FOR_ACTION &&
    effectiveRate.pct < HARD_EXCLUDE_WIN_RATE
  ) {
    return {
      passes: false,
      reason: `Market win rate ${effectiveRate.pct}% — lost more than 60% historically.`,
    };
  }

  if (settings.oddsFilteringEnabled) {
    const band = oddsToBand(odds);
    const bandRate = getOddsBandRate(ctx, band);
    const bypass =
      !bandRate.lowSample &&
      bandRate.sample >= MIN_SAMPLE_FOR_ACTION &&
      bandRate.pct != null &&
      bandRate.pct >= ODDS_FILTER_BYPASS_WIN_RATE;

    if (!bypass && (odds < ODDS_FILTER_MIN || odds > ODDS_FILTER_MAX)) {
      return {
        passes: false,
        reason: `Odds ${odds} outside safe range ${ODDS_FILTER_MIN}–${ODDS_FILTER_MAX}.`,
      };
    }
  }

  return { passes: true, reason: null };
}

export function scoreLegCandidate(
  match: LogMatch,
  marketKey: LogMarketKey,
  pick: RecommendedPick,
  ctx: RecommendationContext,
  league: string,
  settings: RecommendationSettings,
  fineBuckets: Map<string, FineOddsBucketStats>,
  worstBuckets: string[]
): ScoredMatchCandidate {
  const mktPct = marketAccuracyPct(ctx, league, marketKey);
  const bandPct =
    pick.odds != null && isValidOdds(pick.odds)
      ? getOddsBandRate(ctx, oddsToBand(pick.odds)).pct
      : null;
  const legOdds = pick.odds ?? 1;

  const sim = computeMatchSimilarity(ctx, league, match, marketKey, pick, fineBuckets);
  const hasSimilarityHistory = sim.hasDirectHistory;
  const combinedScore = computeCombinedScore(sim.score, sim.oddsSuccessRate);
  const inWorstOddsBucket =
    pick.odds != null && isValidOdds(pick.odds) && isInWorstBucket(pick.odds, worstBuckets);

  const score = computeRiskScore(mktPct, bandPct, pick.confidence, ctx.hasHistory, legOdds);
  const filter = applyHardFilters(
    pick,
    marketKey,
    ctx,
    league,
    settings,
    sim.score,
    hasSimilarityHistory,
    inWorstOddsBucket,
    match
  );

  const concentrationIndex =
    pick.mathSnapshot?.concentrationIndex ??
    concentrationFromGrid(pick.mathSnapshot?.statLayer?.scoreGrid);

  return {
    matchId: match.id,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    marketKey,
    pick,
    riskAdjustedScore: Math.round(score * 100) / 100,
    similarityScore: sim.score,
    combinedScore,
    evidence: sim.evidence,
    inWorstOddsBucket,
    marketAccuracyPct: mktPct,
    oddsBandWinRate: bandPct,
    legOdds,
    passesHardFilters: filter.passes,
    exclusionReason: filter.reason,
    hasSimilarityHistory,
    concentrationIndex,
  };
}

/** One leg per match: highest combined score among non-removed picks. */
export function bestLegForMatch(
  match: LogMatch,
  revised: Partial<Record<LogMarketKey, RecommendedPick>>,
  ctx: RecommendationContext,
  league: string,
  settings: RecommendationSettings,
  fineBuckets: Map<string, FineOddsBucketStats>,
  worstBuckets: string[]
): ScoredMatchCandidate | null {
  const legs: ScoredMatchCandidate[] = [];
  for (const [key, pick] of Object.entries(revised) as [LogMarketKey, RecommendedPick][]) {
    if (!pick || pick.action === "remove") continue;
    legs.push(
      scoreLegCandidate(match, key, pick, ctx, league, settings, fineBuckets, worstBuckets)
    );
  }
  if (legs.length === 0) {
    const removed = Object.entries(revised).find(([, p]) => p?.action === "remove");
    if (removed) {
      const [key, pick] = removed as [LogMarketKey, RecommendedPick];
      return scoreLegCandidate(
        match,
        key,
        pick,
        ctx,
        league,
        settings,
        fineBuckets,
        worstBuckets
      );
    }
    return null;
  }
  legs.sort((a, b) => {
    const aPSignal = a.pick.pSignal ?? a.combinedScore;
    const bPSignal = b.pick.pSignal ?? b.combinedScore;
    // Probability stays the primary criterion (unchanged). Among legs of equal
    // probability we prefer the one that pays a genuine value edge — the
    // professional tie-break. Purely additive: it never overrides pSignal or
    // the hard filters, it only breaks ties that combinedScore used to.
    const aEdge = computeEdgeMetrics(aPSignal, a.pick.odds).edgePct;
    const bEdge = computeEdgeMetrics(bPSignal, b.pick.odds).edgePct;
    return (
      bPSignal - aPSignal ||
      bEdge - aEdge ||
      b.combinedScore - a.combinedScore ||
      b.riskAdjustedScore - a.riskAdjustedScore
    );
  });
  return legs[0]!;
}

export function combinedOddsProduct(legs: ScoredMatchCandidate[]): number {
  if (legs.length === 0) return 0;
  const product = legs.reduce((acc, leg) => acc * leg.legOdds, 1);
  return Math.round(product * 100) / 100;
}

/** User-entered combo leg at batch entry — always passes when odds are valid. */
export function buildComboEntryCandidate(match: LogMatch): ScoredMatchCandidate | null {
  const combo = match.comboPick;
  if (!combo?.comboId || !isValidOdds(combo.odds)) return null;

  const confidence = combo.systemProbability ?? 50;
  const pick: RecommendedPick = {
    prediction: combo.comboId,
    confidence,
    odds: combo.odds,
    action: "keep",
    judgment: "User-entered combo leg.",
    accepted: true,
    pSignal: confidence,
  };

  return {
    matchId: match.id,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    marketKey: "1x2",
    pick,
    riskAdjustedScore: confidence,
    similarityScore: 50,
    combinedScore: confidence,
    evidence: [],
    inWorstOddsBucket: false,
    marketAccuracyPct: null,
    oddsBandWinRate: null,
    legOdds: combo.odds,
    passesHardFilters: true,
    exclusionReason: null,
    hasSimilarityHistory: false,
    concentrationIndex: match.correctScoreSnapshot?.concentrationIndex ?? null,
  };
}

export function riskLevelFromCombinedOdds(product: number): RiskLevel {
  if (product <= RISK_LOW_MAX_ODDS) return "low";
  if (product <= RISK_MEDIUM_MAX_ODDS) return "medium";
  return "high";
}
