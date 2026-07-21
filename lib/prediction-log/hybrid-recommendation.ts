/**
 * 50/50 hybrid recommendation confidence:
 * final = (AI learner score × 0.5) + (system calculation score × 0.5)
 *
 * AI score defaults to neutral 50 until ≥20 scored manual picks exist.
 * Non-blocking — never prevents recommendations.
 * System score may be shrunk toward league prior / season team-card confidence
 * and nudged by qualitative style seeds.
 */
import { learnerConfidenceForOdds } from "./ai-learner";
import { confidenceBand, type ConfidenceBand } from "./master-probability-config";
import {
  getLeaguePrior,
  inferPriorMarketFromLogKey,
  shrinkTowardLeaguePrior,
  type LeaguePriorsStore,
} from "./league-priors";
import {
  PL_LEAGUE_NAME,
  PL_SEASON_2026_27,
  getCardFromStore,
  styleSeedAlign,
  type PlSeasonRosterStore,
  type PlTeamSeasonCard,
} from "./pl-season-roster";
import {
  LL_LEAGUE_NAME,
  LL_SEASON_2026_27,
  getLlCardFromStore,
  type LlSeasonRosterStore,
} from "./ll-season-roster";
import {
  BL_LEAGUE_NAME,
  BL_SEASON_2026_27,
  getBlCardFromStore,
  type BlSeasonRosterStore,
} from "./bl-season-roster";
import { seasonForDate } from "./season";
import type { LearnerStatsStore, LogMarketKey, RecommendedPick } from "./types";

export const HYBRID_AI_WEIGHT = 0.5;
export const HYBRID_SYSTEM_WEIGHT = 0.5;
/** Brief: minimum manual scored picks before AI score is non-neutral. */
export const HYBRID_AI_MIN_SAMPLES = 20;
export const HYBRID_NEUTRAL_AI_SCORE = 50;
const STYLE_SEED_NUDGE = 4;

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

export interface HybridPriorOpts {
  leagueName?: string;
  marketKey?: LogMarketKey | string;
  matchSampleSize?: number;
  leaguePriors?: LeaguePriorsStore | null;
  /** PL 2026/27 cards for team-level confidence / style seeds. */
  plRoster?: PlSeasonRosterStore | null;
  /** La Liga 2026/27 cards for team-level confidence / style seeds. */
  llRoster?: LlSeasonRosterStore | null;
  /** Bundesliga 2026/27 cards for team-level confidence / style seeds. */
  blRoster?: BlSeasonRosterStore | null;
  homeTeam?: string;
  awayTeam?: string;
  matchDate?: string;
}

export interface SystemScoreAudit {
  score: number;
  notes: string[];
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

function relevantCards(opts?: HybridPriorOpts): PlTeamSeasonCard[] {
  const date = opts?.matchDate ?? new Date().toISOString().slice(0, 10);
  const season = seasonForDate(date);
  const out: PlTeamSeasonCard[] = [];

  if (opts?.plRoster && opts.leagueName === PL_LEAGUE_NAME && season === PL_SEASON_2026_27) {
    if (opts.homeTeam) {
      const c = getCardFromStore(opts.plRoster, opts.homeTeam);
      if (c) out.push(c);
    }
    if (opts.awayTeam) {
      const c = getCardFromStore(opts.plRoster, opts.awayTeam);
      if (c) out.push(c);
    }
  }

  if (opts?.llRoster && opts.leagueName === LL_LEAGUE_NAME && season === LL_SEASON_2026_27) {
    if (opts.homeTeam) {
      const c = getLlCardFromStore(opts.llRoster, opts.homeTeam);
      if (c) out.push(c);
    }
    if (opts.awayTeam) {
      const c = getLlCardFromStore(opts.llRoster, opts.awayTeam);
      if (c) out.push(c);
    }
  }

  if (opts?.blRoster && opts.leagueName === BL_LEAGUE_NAME && season === BL_SEASON_2026_27) {
    if (opts.homeTeam) {
      const c = getBlCardFromStore(opts.blRoster, opts.homeTeam);
      if (c) out.push(c);
    }
    if (opts.awayTeam) {
      const c = getBlCardFromStore(opts.blRoster, opts.awayTeam);
      if (c) out.push(c);
    }
  }

  return out;
}

/**
 * Shrink system score toward league market prior when sample is thin,
 * then apply season team-card data_confidence + style_seed nudges (never blocks).
 */
export function getSystemScoreWithLeaguePrior(
  pick: RecommendedPick,
  opts?: HybridPriorOpts
): number {
  return getSystemScoreWithAudit(pick, opts).score;
}

export function getSystemScoreWithAudit(
  pick: RecommendedPick,
  opts?: HybridPriorOpts
): SystemScoreAudit {
  const notes: string[] = [];
  let score = getSystemCalculationScore(pick);
  if (!opts?.leagueName) return { score, notes };

  const market = inferPriorMarketFromLogKey(
    (opts.marketKey as LogMarketKey) ?? "total_goals_ou",
    pick.prediction
  );
  const sample = opts.matchSampleSize ?? pick.dataSampleSize ?? 0;
  const lookup = getLeaguePrior(opts.leagueName, {
    store: opts.leaguePriors,
    market,
    matchSampleSize: sample,
  });

  if (lookup.marketValue != null) {
    const before = score;
    score = clampScore(
      shrinkTowardLeaguePrior(score, lookup.marketValue, sample)
    );
    if (score !== before) {
      notes.push(
        `League prior shrink (${opts.leagueName}, sample ${sample}) → ${score}`
      );
    }
  }

  const cards = relevantCards(opts);
  if (cards.length > 0 && lookup.marketValue != null) {
    // Blend weight = 1 − data_confidence (thin team data → more prior)
    const conf =
      cards.reduce((s, c) => s + c.data_confidence, 0) / cards.length;
    const w = Math.min(1, Math.max(0, 1 - conf));
    if (w > 0.02) {
      const before = score;
      score = clampScore((1 - w) * score + w * lookup.marketValue);
      notes.push(
        `Team prior fallback (${opts.leagueName}, conf=${conf.toFixed(2)}, w=${w.toFixed(2)}) ${before}→${score}`
      );
    }

    // Promoted: extra pull toward prior until samples accrue
    const promotedThin = cards.some(
      (c) => c.is_promoted && (c.matches_played ?? 0) < 8
    );
    if (promotedThin) {
      const before = score;
      score = clampScore(0.7 * score + 0.3 * lookup.marketValue);
      notes.push(`Promoted-club prior pull ${before}→${score}`);
    }

    // Style seed confidence nudge only
    let alignSum = 0;
    let alignN = 0;
    for (const c of cards) {
      if (c.seed_paused) {
        notes.push(`style_seed paused for ${c.team} (roster mismatch)`);
        continue;
      }
      const a = styleSeedAlign(
        c.style_seed,
        String(opts.marketKey ?? ""),
        pick.prediction ?? ""
      );
      if (a !== 0) {
        alignSum += a;
        alignN++;
        if (c.style_seed) {
          notes.push(
            `style_seed→nudge ${c.team} (${c.style_seed.leans.join(",")})`
          );
        }
      } else if (c.matches_played != null && c.matches_played > 0) {
        notes.push(`style_seed→DB overwrite path for ${c.team} (live n=${c.matches_played})`);
      }
    }
    if (alignN > 0) {
      const align = alignSum / alignN;
      score = clampScore(score + align * STYLE_SEED_NUDGE);
    }
  }

  return { score, notes };
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
  stats: LearnerStatsStore | null | undefined,
  priorOpts?: HybridPriorOpts
): RecommendedPick {
  if (pick.action === "remove") return pick;

  const audited = getSystemScoreWithAudit(pick, priorOpts);
  const systemCalculationScore = audited.score;
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
    priorOpts?.leagueName
      ? `League prior shrink applied for ${priorOpts.leagueName} (sample ${priorOpts.matchSampleSize ?? pick.dataSampleSize ?? 0}).`
      : null,
    ...audited.notes,
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
  stats: LearnerStatsStore | null | undefined,
  priorOpts?: Omit<HybridPriorOpts, "marketKey" | "matchSampleSize" | "homeTeam" | "awayTeam"> & {
    leagueName?: string;
  }
): import("./types").RecommendedMatch[] {
  return matches.map((match) => {
    const predictions = Object.fromEntries(
      Object.entries(match.predictions).map(([key, pick]) => [
        key,
        pick
          ? applyHybridToRecommendedPick(pick, stats, {
              ...priorOpts,
              marketKey: key,
              matchSampleSize: pick.dataSampleSize,
              homeTeam: match.homeTeam,
              awayTeam: match.awayTeam,
            })
          : pick,
      ])
    ) as import("./types").RecommendedMatch["predictions"];
    return { ...match, predictions };
  });
}
