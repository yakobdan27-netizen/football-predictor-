import { generateRecommendedBatch } from "./generate-recommended-batch";
import { isCautiousClub, isWeakOddsBandForLearner, learnerConfidenceForOdds } from "./ai-learner";
import {
  isRiskyCharacteristicsMatchup,
  teamCharacteristicsMatchScore,
  marketHintFromKey,
} from "./team-characteristics";
import { isValidOdds } from "./odds-bands";
import { RECO_ENGINE_VERSION } from "./recommendation-config";
import { riskLevelFromCombinedOdds } from "./match-risk-score";
import type {
  AnalysisHistory,
  ClubProfilesStore,
  LearnerPickLabel,
  LearnerStatsStore,
  LogMarketKey,
  PredictionBatch,
  RecommendedBatch,
  RecommendedMatch,
  RecommendedPick,
  RecommendationSettings,
  TeamCharacteristicsStore,
} from "./types";
import type { ClubIndex, ClubRecord } from "./club-record-types";

function combinedOddsOfMatches(matches: RecommendedMatch[]): number | null {
  let product = 1;
  let count = 0;
  for (const rm of matches) {
    for (const pick of Object.values(rm.predictions)) {
      if (pick.action === "remove") continue;
      if (!isValidOdds(pick.odds)) continue;
      product *= pick.odds!;
      count++;
      break;
    }
  }
  if (count === 0) return null;
  return Math.round(product * 100) / 100;
}

function annotatePick(
  pick: RecommendedPick,
  homeTeam: string,
  awayTeam: string,
  league: string,
  stats: LearnerStatsStore,
  selected: boolean,
  teamStore: TeamCharacteristicsStore | null,
  marketKey?: LogMarketKey
): RecommendedPick {
  const weak = isWeakOddsBandForLearner(pick.odds, stats);
  const club = isCautiousClub(homeTeam, awayTeam, league, stats);
  const personalConf = learnerConfidenceForOdds(pick.odds, stats);
  const charScore = teamCharacteristicsMatchScore(
    homeTeam,
    awayTeam,
    league,
    teamStore,
    marketKey ? marketHintFromKey(marketKey) : "general"
  );

  let learnerLabel: LearnerPickLabel;
  let learnerWhy: string;

  if (!selected || pick.action === "remove") {
    learnerLabel = "risk_removed";
    learnerWhy =
      pick.judgment ||
      weak.reason ||
      club.reason ||
      "Excluded by risk filters based on your history.";
    if (weak.weak) learnerWhy = weak.reason!;
    else if (club.cautious) learnerWhy = club.reason!;
  } else if (pick.action === "keep" && !weak.weak && !club.cautious) {
    learnerLabel = "kept_by_learner";
    learnerWhy = personalConf != null
      ? `Kept — your ${pick.odds} odds picks win ${personalConf}% historically.`
      : "Kept — passes personal odds and club filters.";
    if (charScore.score >= 60) {
      learnerWhy += ` Team characteristics score ${charScore.score}/100.`;
    }
  } else {
    learnerLabel = "learner_suggestion";
    const parts: string[] = [];
    if (personalConf != null) parts.push(`Your odds band wins ${personalConf}%`);
    if (stats.topReliableRanges.length > 0) {
      parts.push(`top range: ${stats.topReliableRanges[0]}`);
    }
    if (charScore.score >= 55) parts.push(`team fit ${charScore.score}/100`);
    learnerWhy = parts.length
      ? `Learner suggestion — ${parts.join("; ")}.`
      : "Learner suggestion based on your saved history.";
  }

  if (charScore.reason && charScore.score < 50 && selected) {
    learnerWhy += ` ${charScore.reason}`;
  }

  return {
    ...pick,
    learnerLabel,
    learnerWhy,
    learnerConfidence: personalConf ?? pick.confidence,
  };
}

function applyLearnerPostFilter(
  batch: RecommendedBatch,
  original: PredictionBatch,
  stats: LearnerStatsStore,
  _settings: RecommendationSettings,
  teamStore: TeamCharacteristicsStore | null
): RecommendedBatch {
  const annotatedMatches: RecommendedMatch[] = batch.matches.map((rm) => {
    const marketKey = Object.keys(rm.predictions)[0] as LogMarketKey | undefined;
    const preds: Partial<Record<LogMarketKey, RecommendedPick>> = {};
    for (const [key, pick] of Object.entries(rm.predictions) as [LogMarketKey, RecommendedPick][]) {
      preds[key] = annotatePick(
        pick,
        rm.homeTeam,
        rm.awayTeam,
        original.league,
        stats,
        true,
        teamStore,
        key
      );
    }
    return { ...rm, predictions: preds };
  });

  const filtered = annotatedMatches.filter((rm) => {
    const pick = Object.values(rm.predictions)[0];
    if (!pick) return false;
    const weak = isWeakOddsBandForLearner(pick.odds, stats);
    const club = isCautiousClub(rm.homeTeam, rm.awayTeam, original.league, stats);
    const chars = isRiskyCharacteristicsMatchup(
      rm.homeTeam,
      rm.awayTeam,
      original.league,
      teamStore
    );
    return !weak.weak && !club.cautious && !chars.risky && pick.action !== "remove";
  });

  const selectedIds = new Set(filtered.map((m) => m.id));

  const gameList = batch.gameList.map((entry) => {
    const weak = entry.legOdds != null ? isWeakOddsBandForLearner(entry.legOdds, stats) : { weak: false };
    const club = isCautiousClub(entry.homeTeam, entry.awayTeam, original.league, stats);
    const chars = isRiskyCharacteristicsMatchup(
      entry.homeTeam,
      entry.awayTeam,
      original.league,
      teamStore
    );
    const learnerSelected = selectedIds.has(entry.matchId);
    let skipReason = entry.skipReason;
    if (!learnerSelected && (weak.weak || club.cautious || chars.risky)) {
      skipReason = weak.reason ?? club.reason ?? chars.reason ?? skipReason;
    }
    return {
      ...entry,
      selected: learnerSelected,
      skipReason,
    };
  });

  const totalCombinedOdds = combinedOddsOfMatches(filtered);
  const riskLevel = totalCombinedOdds
    ? riskLevelFromCombinedOdds(totalCombinedOdds)
    : batch.summary.riskLevel;

  const learnerRemoved = batch.matches.length - filtered.length;
  let summaryJudgment = batch.summary.summaryJudgment;
  if (learnerRemoved > 0) {
    summaryJudgment += ` AI Learner removed ${learnerRemoved} high-risk leg(s) from your personal history.`;
  }
  summaryJudgment += ` Suggested combined-odds ceiling: ${stats.suggestedCombinedOddsCeiling}.`;

  return {
    ...batch,
    displayName: `${original.batchName} – Learner Recommended`,
    engineVersion: RECO_ENGINE_VERSION,
    learnerGenerated: true,
    learnerAdvice: stats.advice,
    matches: filtered,
    gameList,
    summary: {
      ...batch.summary,
      totalCombinedOdds,
      riskLevel,
      matchesIncluded: filtered.length,
      matchesDropped: original.matches.length - filtered.length,
      summaryJudgment,
    },
  };
}

/** Generate a recommended batch with AI Learner overlay from personal history. */
export function generateLearnerRecommendedBatch(
  original: PredictionBatch,
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  settings: RecommendationSettings,
  clubProfiles: ClubProfilesStore | null,
  learnerStats: LearnerStatsStore,
  teamCharacteristics: TeamCharacteristicsStore | null = null,
  clubRecords: Record<string, ClubRecord> | null = null,
  clubIndex: ClubIndex | null = null,
  luckyNumbers: number[] = []
): RecommendedBatch | null {
  const learnerSettings: RecommendationSettings = {
    ...settings,
    oddsFilteringEnabled: true,
  };

  const base = generateRecommendedBatch(
    original,
    allBatches,
    analysis,
    learnerSettings,
    clubProfiles,
    clubRecords,
    clubIndex,
    luckyNumbers
  );

  if (!base) {
    return null;
  }

  return applyLearnerPostFilter(base, original, learnerStats, learnerSettings, teamCharacteristics);
}

/** Annotate an existing recommended batch with learner labels (when toggle turned on). */
export function overlayLearnerOnBatch(
  batch: RecommendedBatch,
  original: PredictionBatch,
  stats: LearnerStatsStore,
  settings: RecommendationSettings,
  teamCharacteristics: TeamCharacteristicsStore | null = null
): RecommendedBatch {
  return applyLearnerPostFilter(batch, original, stats, settings, teamCharacteristics);
}
