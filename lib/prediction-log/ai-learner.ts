import { flattenScoredRows } from "./analysis";
import { collectComboLearnerUpdates } from "./combo-scoring";
import { recomputeCorrectScoreStats } from "./correct-score-learning";
import { oddsToBand, isValidOdds } from "./odds-bands";
import { DEFAULT_MAX_COMBINED_ODDS } from "./recommendation-config";
import type {
  AnalysisHistory,
  BatchPatternStat,
  ClubCautionStat,
  ClubProfilesStore,
  LearnerAdvice,
  LearnerStatsStore,
  OddsBandId,
  OddsRangeLearnerStat,
  PredictionBatch,
  ScoredRow,
  ComboTypeLearnerStat,
} from "./types";
import { LEARNER_SCHEMA_VERSION } from "./types";

const BAND_ORDER: OddsBandId[] = ["1.00-1.50", "1.51-2.00", "2.01-2.50", "2.51-3.00"];

const BATCH_BUCKETS: Array<{
  label: string;
  min?: number;
  max?: number;
}> = [
  { label: "Combined odds ≤ 4.00", max: 4 },
  { label: "Combined odds 4.01–6.00", min: 4.01, max: 6 },
  { label: "Combined odds 6.01–8.00", min: 6.01, max: 8 },
  { label: "Combined odds > 8.00", min: 8.01 },
];

const MIN_LEARNER_SAMPLE = 5;
const MIN_BATCH_PATTERN_SAMPLE = 3;
const WEAK_RANGE_THRESHOLD = 40;
const STRONG_RANGE_THRESHOLD = 55;
const CLUB_CAUTION_THRESHOLD = 38;
const CLUB_CAUTION_MIN_SAMPLE = 4;

function emptyOddsRanges(): OddsRangeLearnerStat[] {
  return BAND_ORDER.map((band) => ({
    band,
    wins: 0,
    losses: 0,
    winRate: null,
    sample: 0,
  }));
}

function computeOddsRangeStats(rows: ScoredRow[]): OddsRangeLearnerStat[] {
  const map = new Map<OddsBandId, { wins: number; losses: number }>();
  for (const band of BAND_ORDER) {
    map.set(band, { wins: 0, losses: 0 });
  }

  for (const row of rows) {
    if (!isValidOdds(row.odds)) continue;
    if (row.result !== "correct" && row.result !== "wrong") continue;
    const band = oddsToBand(row.odds);
    const entry = map.get(band)!;
    if (row.result === "correct") entry.wins++;
    else entry.losses++;
  }

  return BAND_ORDER.map((band) => {
    const { wins, losses } = map.get(band)!;
    const sample = wins + losses;
    return {
      band,
      wins,
      losses,
      sample,
      winRate: sample > 0 ? Math.round((wins / sample) * 100) : null,
    };
  });
}

function batchPrimaryOdds(batch: PredictionBatch): number | null {
  let product = 1;
  let count = 0;
  for (const match of batch.matches) {
    const preds = Object.values(match.predictions).filter((p) => isValidOdds(p?.odds));
    if (!preds.length) continue;
    const lowest = preds.reduce((a, b) => ((a.odds ?? 99) < (b.odds ?? 99) ? a : b));
    product *= lowest.odds!;
    count++;
  }
  if (count === 0) return null;
  return Math.round(product * 100) / 100;
}

function batchAccumulatorWon(batch: PredictionBatch): boolean | null {
  let anyScored = false;
  let allCorrect = true;
  for (const match of batch.matches) {
    for (const r of Object.values(match.scored)) {
      if (r === "correct" || r === "wrong") {
        anyScored = true;
        if (r === "wrong") allCorrect = false;
      }
    }
  }
  if (!anyScored) return null;
  return allCorrect;
}

function inBatchBucket(combined: number, bucket: (typeof BATCH_BUCKETS)[number]): boolean {
  if (bucket.min != null && combined < bucket.min) return false;
  if (bucket.max != null && combined > bucket.max) return false;
  return true;
}

function computeBatchPatterns(batches: PredictionBatch[]): BatchPatternStat[] {
  return BATCH_BUCKETS.map((bucket) => {
    let total = 0;
    let wins = 0;
    for (const batch of batches) {
      const combined = batchPrimaryOdds(batch);
      if (combined == null || !inBatchBucket(combined, bucket)) continue;
      const outcome = batchAccumulatorWon(batch);
      if (outcome == null) continue;
      total++;
      if (outcome) wins++;
    }
    return {
      label: bucket.label,
      totalBatches: total,
      winningBatches: wins,
      winRate: total > 0 ? Math.round((wins / total) * 100) : null,
      lowSample: total < MIN_BATCH_PATTERN_SAMPLE,
    };
  });
}

function computeCautiousClubs(clubProfiles: ClubProfilesStore | null): ClubCautionStat[] {
  if (!clubProfiles?.profiles) return [];
  const cautions: ClubCautionStat[] = [];

  for (const profile of Object.values(clubProfiles.profiles)) {
    const wm = profile.weightedMetrics;
    const blended = wm.result1x2;
    const sample = blended.sample;
    const pct = blended.pct;

    if (sample >= CLUB_CAUTION_MIN_SAMPLE && pct != null && pct < CLUB_CAUTION_THRESHOLD) {
      cautions.push({
        clubName: profile.clubName,
        league: profile.league,
        winRate: pct,
        sample,
        reason: `Your picks on ${profile.clubName} hit only ${pct}% (${sample} scored picks).`,
      });
      continue;
    }

    if (profile.tags.includes("high_risk") && sample >= 3) {
      cautions.push({
        clubName: profile.clubName,
        league: profile.league,
        winRate: pct,
        sample,
        reason: profile.weaknesses[0] ?? `${profile.clubName} flagged as high-risk in your history.`,
      });
    }
  }

  return cautions.sort((a, b) => (a.winRate ?? 0) - (b.winRate ?? 0)).slice(0, 8);
}

function suggestCombinedOddsCeiling(patterns: BatchPatternStat[]): number {
  const viable = patterns.filter(
    (p) => !p.lowSample && p.winRate != null && p.winRate >= STRONG_RANGE_THRESHOLD
  );
  if (viable.length === 0) return DEFAULT_MAX_COMBINED_ODDS;

  const best = viable.reduce((a, b) => (a.winRate! >= b.winRate! ? a : b));
  if (best.label.includes("≤ 4")) return 4;
  if (best.label.includes("4.01")) return 6;
  if (best.label.includes("6.01")) return 8;
  return DEFAULT_MAX_COMBINED_ODDS;
}

export function buildLearnerAdvice(stats: Omit<LearnerStatsStore, "advice">): LearnerAdvice {
  const topReliableRanges = stats.oddsRanges
    .filter((r) => r.sample >= MIN_LEARNER_SAMPLE && r.winRate != null)
    .sort((a, b) => b.winRate! - a.winRate!)
    .slice(0, 3)
    .map((r) => ({ band: r.band, winRate: r.winRate!, sample: r.sample }));

  const batchPatternWarnings: string[] = [];
  for (const p of stats.batchPatterns) {
    if (p.lowSample || p.winRate == null) continue;
    if (p.winRate < WEAK_RANGE_THRESHOLD) {
      batchPatternWarnings.push(
        `${p.label}: you win ${p.winRate}% of batches (${p.winningBatches}/${p.totalBatches}).`
      );
    }
  }

  let summaryLine = "Keep logging results — the learner improves as your history grows.";
  if (stats.totalScoredPicks >= MIN_LEARNER_SAMPLE) {
    const top = topReliableRanges[0];
    if (top) {
      summaryLine = `Your strongest odds range is ${top.band} at ${top.winRate}% (${top.sample} picks).`;
    }
    if (batchPatternWarnings.length > 0) {
      summaryLine += ` ${batchPatternWarnings[0]}`;
    }
  }

  return {
    topReliableRanges,
    cautiousClubs: stats.cautiousClubs,
    suggestedCombinedOddsCeiling: stats.suggestedCombinedOddsCeiling,
    batchPatternWarnings,
    summaryLine,
  };
}

function computeComboTypeStats(batches: PredictionBatch[]): Record<string, ComboTypeLearnerStat> {
  const raw = collectComboLearnerUpdates(batches);
  const out: Record<string, ComboTypeLearnerStat> = {};
  for (const [id, { wins, losses }] of Object.entries(raw)) {
    const sample = wins + losses;
    out[id] = {
      wins,
      losses,
      winRate: sample > 0 ? Math.round((wins / sample) * 100) : null,
    };
  }
  return out;
}

export function recomputeLearnerStats(
  batches: PredictionBatch[],
  _analysis: AnalysisHistory | null,
  clubProfiles: ClubProfilesStore | null
): LearnerStatsStore {
  const rows = flattenScoredRows(batches);
  const oddsRanges = computeOddsRangeStats(rows);

  const topReliableRanges = oddsRanges
    .filter((r) => r.sample >= MIN_LEARNER_SAMPLE && r.winRate != null && r.winRate >= STRONG_RANGE_THRESHOLD)
    .sort((a, b) => b.winRate! - a.winRate!)
    .map((r) => r.band);

  const weakestRanges = oddsRanges
    .filter((r) => r.sample >= MIN_LEARNER_SAMPLE && r.winRate != null && r.winRate < WEAK_RANGE_THRESHOLD)
    .sort((a, b) => a.winRate! - b.winRate!)
    .map((r) => r.band);

  const batchPatterns = computeBatchPatterns(batches);
  const cautiousClubs = computeCautiousClubs(clubProfiles);
  const suggestedCombinedOddsCeiling = suggestCombinedOddsCeiling(batchPatterns);
  const comboTypeStats = computeComboTypeStats(batches);
  const correctScoreStats = recomputeCorrectScoreStats(batches);

  const batchesWithResults = batches.filter((b) => batchAccumulatorWon(b) != null).length;

  const base: Omit<LearnerStatsStore, "advice"> = {
    schemaVersion: LEARNER_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    learnerVersion: 1,
    totalBatchesWithResults: batchesWithResults,
    totalScoredPicks: rows.filter((r) => r.result === "correct" || r.result === "wrong").length,
    oddsRanges: oddsRanges.length ? oddsRanges : emptyOddsRanges(),
    topReliableRanges,
    weakestRanges,
    batchPatterns,
    cautiousClubs,
    suggestedCombinedOddsCeiling,
    comboTypeStats,
    correctScoreStats,
  };

  return { ...base, advice: buildLearnerAdvice(base) };
}

export function emptyLearnerStats(): LearnerStatsStore {
  const base: Omit<LearnerStatsStore, "advice"> = {
    schemaVersion: LEARNER_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    learnerVersion: 1,
    totalBatchesWithResults: 0,
    totalScoredPicks: 0,
    oddsRanges: emptyOddsRanges(),
    topReliableRanges: [],
    weakestRanges: [],
    batchPatterns: [],
    cautiousClubs: [],
    suggestedCombinedOddsCeiling: DEFAULT_MAX_COMBINED_ODDS,
    comboTypeStats: {},
    correctScoreStats: {
      overall: { top1Hits: 0, top3Hits: 0, top6Hits: 0, sample: 0 },
      byLeague: {},
      rollingTop3Rate: null,
    },
  };
  return { ...base, advice: buildLearnerAdvice(base) };
}

export function isWeakOddsBandForLearner(
  odds: number | undefined,
  stats: LearnerStatsStore
): { weak: boolean; reason?: string } {
  if (!isValidOdds(odds)) return { weak: false };
  const band = oddsToBand(odds);
  if (!stats.weakestRanges.includes(band)) return { weak: false };
  const row = stats.oddsRanges.find((r) => r.band === band);
  if (!row || row.sample < MIN_LEARNER_SAMPLE) return { weak: false };
  return {
    weak: true,
    reason: `Your ${band} range wins only ${row.winRate}% (${row.wins}W/${row.losses}L).`,
  };
}

export function isCautiousClub(
  homeTeam: string,
  awayTeam: string,
  league: string,
  stats: LearnerStatsStore
): { cautious: boolean; reason?: string } {
  for (const club of [homeTeam, awayTeam]) {
    const entry = stats.cautiousClubs.find(
      (c) => c.clubName === club && c.league === league
    );
    if (entry) return { cautious: true, reason: entry.reason };
  }
  return { cautious: false };
}

export function learnerConfidenceForOdds(
  odds: number | undefined,
  stats: LearnerStatsStore
): number | null {
  if (!isValidOdds(odds)) return null;
  const band = oddsToBand(odds);
  const row = stats.oddsRanges.find((r) => r.band === band);
  if (!row || row.sample < 3) return null;
  return row.winRate;
}

export {
  MIN_LEARNER_SAMPLE,
  WEAK_RANGE_THRESHOLD,
};
