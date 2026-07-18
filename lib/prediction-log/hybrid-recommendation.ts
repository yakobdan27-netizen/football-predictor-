/**
 * 50/50 hybrid recommendation confidence:
 * final = (AI learner score × 0.5) + (system calculation score × 0.5)
 *
 * AI score defaults to neutral 50 until ≥20 scored manual picks exist.
 * Non-blocking — never prevents recommendations.
 */
import { learnerConfidenceForOdds } from "./ai-learner";
import { confidenceBand, type ConfidenceBand } from "./master-probability-config";
import type { LearnerStatsStore, RecommendedPick } from "./types";

export const HYBRID_AI_WEIGHT = 0.5;
export const HYBRID_SYSTEM_WEIGHT = 0.5;
/** Brief: minimum manual scored picks before AI score is non-neutral. */
export const HYBRID_AI_MIN_SAMPLES = 20;
export const HYBRID_NEUTRAL_AI_SCORE = 50;

export type HybridRecommendationLevel = "STRONG" | "MODERATE" | "WEAK";

export interface HybridRecommendationResult {
  aiLearnerScore: number;
  systemCalculationScore: number;
  hybridConfidence: number;
  aiContribution: number;
  systemContribution: number;
  aiContributionWeight: number;
  systemContributionWeight: number;
  recommendation: HybridRecommendationLevel;
  confidenceBand: ConfidenceBand;
  aiSamples: number;
  aiNeutral: boolean;
  breakdownLabel: string;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return HYBRID_NEUTRAL_AI_SCORE;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

function overallLearnerWinRate(stats: LearnerStatsStore): number | null {
  let wins = 0;
  let losses = 0;
  for (const row of stats.oddsRanges) {
    wins += row.wins;
    losses += row.losses;
  }
  const sample = wins + losses;
  if (sample <= 0) return null;
  return Math.round((wins / sample) * 1000) / 10;
}

export function hybridRecommendationLevel(score: number): HybridRecommendationLevel {
  if (score >= 65) return "STRONG";
  if (score >= 55) return "MODERATE";
  return "WEAK";
}

/**
 * AI learner score (0–100) from personal scored history.
 * < HYBRID_AI_MIN_SAMPLES → neutral 50.
 */
export function getAILearnerScore(
  stats: LearnerStatsStore | null | undefined,
  odds?: number
): { score: number; samples: number; aiNeutral: boolean } {
  const samples = stats?.totalScoredPicks ?? 0;
  if (!stats || samples < HYBRID_AI_MIN_SAMPLES) {
    return { score: HYBRID_NEUTRAL_AI_SCORE, samples, aiNeutral: true };
  }

  const band = learnerConfidenceForOdds(odds, stats);
  if (band != null) {
    return { score: clampScore(band), samples, aiNeutral: false };
  }

  const overall = overallLearnerWinRate(stats);
  return {
    score: clampScore(overall ?? HYBRID_NEUTRAL_AI_SCORE),
    samples,
    aiNeutral: overall == null,
  };
}

export function getSystemCalculationScore(pick: RecommendedPick): number {
  const raw = pick.pFinal ?? pick.pSignal ?? pick.confidence;
  return clampScore(raw ?? HYBRID_NEUTRAL_AI_SCORE);
}

export function calculateHybridRecommendation(
  systemScore: number,
  aiScore: number,
  opts?: { aiSamples?: number; aiNeutral?: boolean }
): HybridRecommendationResult {
  const systemCalculationScore = clampScore(systemScore);
  const aiLearnerScore = clampScore(aiScore);
  const hybridConfidence = clampScore(
    aiLearnerScore * HYBRID_AI_WEIGHT + systemCalculationScore * HYBRID_SYSTEM_WEIGHT
  );
  const aiContribution = clampScore(aiLearnerScore * HYBRID_AI_WEIGHT);
  const systemContribution = clampScore(systemCalculationScore * HYBRID_SYSTEM_WEIGHT);
  const aiNeutral = opts?.aiNeutral ?? false;
  const aiSamples = opts?.aiSamples ?? 0;

  return {
    aiLearnerScore,
    systemCalculationScore,
    hybridConfidence,
    aiContribution,
    systemContribution,
    aiContributionWeight: HYBRID_AI_WEIGHT,
    systemContributionWeight: HYBRID_SYSTEM_WEIGHT,
    recommendation: hybridRecommendationLevel(hybridConfidence),
    confidenceBand: confidenceBand(hybridConfidence),
    aiSamples,
    aiNeutral,
    breakdownLabel: `AI: ${aiContribution}% | System: ${systemContribution}%`,
  };
}

/** Apply 50/50 hybrid fields onto a recommended pick (after system pFinal is set). */
export function applyHybridToRecommendedPick(
  pick: RecommendedPick,
  stats: LearnerStatsStore | null | undefined
): RecommendedPick {
  if (pick.action === "remove") return pick;

  const systemCalculationScore = getSystemCalculationScore(pick);
  const ai = getAILearnerScore(stats, pick.odds);
  const hybrid = calculateHybridRecommendation(systemCalculationScore, ai.score, {
    aiSamples: ai.samples,
    aiNeutral: ai.aiNeutral,
  });

  const breakdownParts = [
    pick.confidenceBreakdown,
    `Hybrid 50/50 — ${hybrid.breakdownLabel} → ${hybrid.hybridConfidence}% (${hybrid.recommendation})`,
    ai.aiNeutral
      ? `AI neutral (${HYBRID_NEUTRAL_AI_SCORE}) until ${HYBRID_AI_MIN_SAMPLES} scored picks (${ai.samples} so far).`
      : `AI from ${ai.samples} scored picks.`,
  ].filter(Boolean);

  return {
    ...pick,
    aiLearnerScore: hybrid.aiLearnerScore,
    systemCalculationScore: hybrid.systemCalculationScore,
    hybridConfidence: hybrid.hybridConfidence,
    hybridRecommendation: hybrid.recommendation,
    aiContributionWeight: hybrid.aiContributionWeight,
    systemContributionWeight: hybrid.systemContributionWeight,
    learnerConfidence: hybrid.aiLearnerScore,
    confidence: hybrid.hybridConfidence,
    confidenceBand: hybrid.confidenceBand,
    confidenceBreakdown: breakdownParts.join(" "),
  };
}

export function applyHybridToRecommendedMatches(
  matches: import("./types").RecommendedMatch[],
  stats: LearnerStatsStore | null | undefined
): import("./types").RecommendedMatch[] {
  return matches.map((match) => {
    const predictions = Object.fromEntries(
      Object.entries(match.predictions).map(([key, pick]) => [
        key,
        pick ? applyHybridToRecommendedPick(pick, stats) : pick,
      ])
    ) as import("./types").RecommendedMatch["predictions"];
    return { ...match, predictions };
  });
}
