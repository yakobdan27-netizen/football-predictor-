import assert from "node:assert/strict";
import { scoreMarket, scoreMatch } from "./scoring";
import { recomputeAnalysis } from "./analysis";
import { buildExportCsv, buildOddsAnalysisCsv, buildComparisonCsv } from "./export";
import { generateRecommendedBatch } from "./generate-recommended-batch";
import { generateBestRecommendationBatch } from "./generate-tiered-recommendations";
import {
  collectPriorOccupiedMarkets,
  filterCandidatesByOccupiedMarkets,
  isSameDateDedupReason,
  marketOccupancyKey,
} from "./same-date-market-dedup";

import { defaultRecommendationSettings, RECO_ENGINE_VERSION } from "./recommendation-config";
import { buildBetterAlternative } from "./freeze-batch-snapshot";
import {
  computeFineOddsBuckets,
  detectWorstOddsBuckets,
  oddsToFineBucket,
} from "./odds-bucket-analysis";
import { scoreBatch } from "./scoring";
import { teamsForLeague, isValidFixture } from "./teams";
import { oddsToBand, isValidOdds } from "./odds-bands";
import { isValueBet } from "./systematic-odds";
import { computeOddsAnalysis } from "./odds-analysis";
import type { AnalysisHistory, LogMatch, PredictionBatch, ScoredRow } from "./types";
import { emptyOddsAnalysis } from "./odds-analysis";
import {
  parseLuckyNumbersInput,
  oddsMatchesLuckyNumber,
  luckyInfluenceNote,
} from "./lucky-numbers";
import { computeLearnerPatterns, overallWinRate } from "./learner-patterns";
import { emptyLearnerStats } from "./ai-learner";
import { emptyTeamCharacteristicsStore } from "./team-characteristics";
import { analyzeBatch, analyzeAllBatches } from "./batch-analysis";
import { batchRiskBand } from "./batch-risk-config";
import { confidenceBand } from "./master-probability-config";
import {
  computeCapacityEdge,
  computeFormSignal,
  computeH2HSignal,
  computeYourAccuracy,
  computeLuckySignal,
  blendSignals,
  computeROdds,
  computeRBatch,
  computePFinal,
  computeRLoss,
} from "./master-probability";
import {
  computeBatchRisk,
  computeReductionPlan,
  type ActiveLeg,
} from "./dynamic-batch-risk";
import { emptyCapacity, createClubRecord as createClubRecordRaw } from "./club-record-types";
import { applyTeamStatsSync } from "./team-stats-sync";
import { resolveResultForType } from "./club-history-writer";
import { scoreComboLeg, scoreComboAccumulator } from "./combo-scoring";
import { jointProbPercent } from "@/lib/predictor/score-matrix";
import { validateMatchLeg, switchMarketMode } from "./match-entry-helpers";
import { buildComboEntryCandidate } from "./match-risk-score";

// Team lists
assert.ok(teamsForLeague("Premier League").includes("Arsenal"));
assert.ok(isValidFixture("Arsenal", "Chelsea", "Premier League"));
assert.ok(!isValidFixture("Arsenal", "Arsenal", "Premier League"));
assert.ok(teamsForLeague("UEFA Champions League").length > 0);
assert.ok(isValidFixture("Arsenal", "Barcelona", "UEFA Champions League"));
assert.ok(isValidFixture("Bayern Munich", "Inter", "UEFA Europa League"));
assert.ok(isValidFixture("Lyon", "Roma", "UEFA Europa Conference League"));

// Odds bands
assert.equal(oddsToBand(2.0), "1.51-2.00");
assert.equal(oddsToBand(2.01), "2.01-2.50");
assert.equal(oddsToBand(1.5), "1.00-1.50");
assert.ok(isValidOdds(1.85));
assert.ok(!isValidOdds(3.01));

// Value bet: 60% confidence at 2.0 odds (50% implied + 8% = 58%)
assert.ok(isValueBet(60, 2.0));
assert.ok(!isValueBet(55, 2.0));

// O/U corners: Over 9.5, actual 11 -> correct; 8 -> wrong; 9.5 -> push
assert.equal(scoreMarket("corners_ou", "over", 9.5, 11), "correct");
assert.equal(scoreMarket("corners_ou", "over", 9.5, 8), "wrong");
assert.equal(scoreMarket("corners_ou", "over", 9.5, 9.5), "push");

assert.equal(scoreMarket("1x2", "home", undefined, ""), null);

const match: LogMatch = {
  id: "m1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: {
    "1x2": { prediction: "home", confidence: 80, odds: 1.75 },
    corners_ou: { prediction: "over", line: 9.5, confidence: 60, odds: 2.1 },
  },
  actualResults: {
    "1x2": { actual: "home" },
    corners_ou: { actual: 11 },
  },
  scored: {},
};

const scored = scoreMatch(match);
assert.equal(scored.scored["1x2"], "correct");
assert.equal(scored.scored.corners_ou, "correct");

const batch: PredictionBatch = {
  id: "b1",
  date: "2026-04-18",
  league: "Premier League",
  batchName: "Test batch",
  createdAt: new Date().toISOString(),
  matches: [
    scored,
    {
      id: "m2",
      homeTeam: "Liverpool",
      awayTeam: "Spurs",
      predictions: { btts: { prediction: "yes", confidence: 70, odds: 1.9 } },
      actualResults: {},
      scored: {},
    },
  ],
};

const analysis = recomputeAnalysis([batch]);
assert.ok(analysis.totalScored >= 2);
assert.ok(analysis.oddsAnalysis);
assert.ok(analysis.oddsAnalysis.bands["1.51-2.00"].total >= 1);

const oddsRows: ScoredRow[] = [
  {
    batchId: "b",
    batchName: "B",
    league: "PL",
    date: "2026-01-01",
    homeTeam: "A",
    awayTeam: "B",
    market: "1x2",
    prediction: "home",
    confidence: 70,
    odds: 2.0,
    actual: "home",
    result: "correct",
  },
  {
    batchId: "b",
    batchName: "B",
    league: "PL",
    date: "2026-01-01",
    homeTeam: "C",
    awayTeam: "D",
    market: "btts",
    prediction: "yes",
    confidence: 60,
    odds: 2.0,
    actual: "no",
    result: "wrong",
  },
];
const oa = computeOddsAnalysis(oddsRows);
assert.equal(oa.bands["1.51-2.00"].wins, 1);
assert.equal(oa.bands["1.51-2.00"].losses, 1);
assert.ok(oa.bands["1.51-2.00"].lowSample);

const csv = buildExportCsv([batch]);
assert.ok(csv.includes("odds"));
assert.ok(csv.includes("1.75"));

const oddsCsv = buildOddsAnalysisCsv([batch]);
assert.ok(oddsCsv.includes("oddsBand"));

const defaultSettings = defaultRecommendationSettings();

// Cold start recommended batch
const coldBatch: PredictionBatch = {
  id: "cold1",
  date: "2026-06-01",
  league: "Premier League",
  batchName: "Cold start",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "cm1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { btts: { prediction: "yes", confidence: 70, odds: 1.85 } },
      actualResults: {},
      scored: {},
    },
  ],
};
const coldAnalysis = recomputeAnalysis([]);
const coldReco = generateRecommendedBatch(coldBatch, [coldBatch], coldAnalysis, defaultSettings);
assert.ok(coldReco);
assert.ok(coldReco!.displayName.includes("Recommended"));
const coldPick = coldReco!.matches[0]!.predictions.btts!;
assert.equal(coldPick.action, "keep");
assert.ok(coldPick.judgment.includes("Insufficient history"));
assert.ok(coldReco!.summary.totalCombinedOdds != null);

// Conservative: recommended odds never exceed original
for (const rm of coldReco!.matches) {
  for (const [key, rp] of Object.entries(rm.predictions) as [string, { odds?: number; original?: { odds?: number } }][]) {
    const orig = coldBatch.matches.find((m) => m.id === rm.id)?.predictions[key as keyof typeof rm.predictions];
    if (orig?.odds != null && rp.odds != null) {
      assert.ok(rp.odds <= orig.odds, `odds should not increase: ${rp.odds} > ${orig.odds}`);
    }
  }
}

assert.ok(coldPick.confidenceBreakdown);
assert.ok(coldPick.confidence <= 70);

// System confidence blends scenarios when history exists
const confAnalysis: AnalysisHistory = {
  schemaVersion: 3,
  updatedAt: new Date().toISOString(),
  totalScored: 30,
  marketAccuracy: { btts: { correct: 7, wrong: 3, push: 0, pct: 70 } },
  leagueAccuracy: {
    "Premier League": { btts: { correct: 7, wrong: 3, push: 0, pct: 70 } },
  },
  highConfidenceAccuracy: { correct: 5, wrong: 5, push: 0, pct: 50 },
  recentForm: { correct: 6, wrong: 4, push: 0, pct: 60 },
  topMarkets: [],
  weakestMarkets: [],
  calibrationNote: "",
  oddsAnalysis: emptyOddsAnalysis(),
};
const confBatch: PredictionBatch = {
  id: "conf1",
  date: "2026-06-07",
  league: "Premier League",
  batchName: "Confidence blend",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "cf1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { btts: { prediction: "yes", confidence: 85, odds: 1.8 } },
      actualResults: {},
      scored: {},
    },
  ],
};
const confReco = generateRecommendedBatch(confBatch, [confBatch], confAnalysis, defaultSettings);
assert.ok(confReco);
const confPick = confReco!.matches[0]!.predictions.btts!;
assert.ok(confPick.confidence < 85, "system should lower overconfident pick");
assert.ok(confPick.confidenceBreakdown?.includes("P_signal"));

// Weak market history triggers revision
function makeAnalysisWithWeak1x2(): AnalysisHistory {
  return {
    schemaVersion: 3,
    updatedAt: new Date().toISOString(),
    totalScored: 20,
    marketAccuracy: {
      "1x2": { correct: 2, wrong: 8, push: 0, pct: 20 },
    },
    leagueAccuracy: {
      "Premier League": {
        "1x2": { correct: 2, wrong: 8, push: 0, pct: 20 },
      },
    },
    highConfidenceAccuracy: { correct: 0, wrong: 0, push: 0, pct: null },
    recentForm: { correct: 0, wrong: 0, push: 0, pct: null },
    topMarkets: [],
    weakestMarkets: [],
    calibrationNote: "",
    oddsAnalysis: emptyOddsAnalysis(),
  };
}

const weakBatch: PredictionBatch = {
  id: "weak1",
  date: "2026-06-02",
  league: "Premier League",
  batchName: "Weak 1x2",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "wm1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { "1x2": { prediction: "home", confidence: 75, odds: 2.0 } },
      actualResults: {},
      scored: {},
    },
  ],
};
const weakAnalysis = makeAnalysisWithWeak1x2();
const weakReco = generateRecommendedBatch(weakBatch, [weakBatch], weakAnalysis, defaultSettings);
assert.ok(weakReco);
const weakLeg = weakReco!.matches[0]!.predictions.double_chance;
assert.ok(weakLeg, "should select double chance leg");
assert.equal(weakLeg!.action, "add_alternative");

// O/U over revision when market weak (similarity boosted by strong odds band)
function oddsAnalysisWithStrongBand(): AnalysisHistory["oddsAnalysis"] {
  const oa = emptyOddsAnalysis();
  const bandStat = {
    band: "1.51-2.00" as const,
    total: 10,
    wins: 10,
    losses: 0,
    pushes: 0,
    winRate: 100,
    avgWinOdds: 1.9,
    avgLossOdds: null,
    valueScore: null,
    lowSample: false,
  };
  oa.bands["1.51-2.00"] = bandStat;
  oa.recentBands["1.51-2.00"] = { ...bandStat };
  return oa;
}
const ouAnalysis: AnalysisHistory = {
  ...makeAnalysisWithWeak1x2(),
  marketAccuracy: {
    corners_ou: { correct: 4, wrong: 5, push: 0, pct: 44 },
  },
  leagueAccuracy: {
    "Premier League": {
      corners_ou: { correct: 4, wrong: 5, push: 0, pct: 44 },
    },
  },
  oddsAnalysis: oddsAnalysisWithStrongBand(),
};
const ouBatch: PredictionBatch = {
  id: "ou1",
  date: "2026-06-03",
  league: "Premier League",
  batchName: "OU revise",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "om1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: {
        corners_ou: { prediction: "over", line: 9.5, confidence: 65, odds: 1.9 },
      },
      actualResults: {},
      scored: {},
    },
  ],
};
const ouReco = generateRecommendedBatch(ouBatch, [ouBatch], ouAnalysis, defaultSettings);
assert.ok(ouReco);
const ouPick = ouReco!.matches[0]!.predictions.corners_ou!;
assert.equal(ouPick.action, "revise");
assert.equal(ouPick.line, 8.5);

// 10-match batch — no fixed cap; all safe legs included
function makeSafeMatch(i: number): LogMatch {
  return {
    id: `big-m${i}`,
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    predictions: { btts: { prediction: "yes", confidence: 75, odds: 1.5 } },
    actualResults: {},
    scored: {},
  };
}
const bigBatch: PredictionBatch = {
  id: "big1",
  date: "2026-06-04",
  league: "Premier League",
  batchName: "Big batch",
  createdAt: new Date().toISOString(),
  matches: Array.from({ length: 10 }, (_, i) => makeSafeMatch(i)),
};
const bigReco = generateRecommendedBatch(bigBatch, [bigBatch], coldAnalysis, defaultSettings);
assert.ok(bigReco);
assert.ok(bigReco!.matches.length > 4);
assert.equal(bigReco!.matches.length, 10);
assert.ok(bigReco!.summary.summaryJudgment.includes("of 10 matches"));

// All high-risk odds fail filters -> null
const riskyBatch: PredictionBatch = {
  id: "risky",
  date: "2026-06-05",
  league: "Premier League",
  batchName: "Risky",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "r1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { btts: { prediction: "yes", confidence: 50, odds: 2.9 } },
      actualResults: {},
      scored: {},
    },
    {
      id: "r2",
      homeTeam: "Liverpool",
      awayTeam: "Spurs",
      predictions: { btts: { prediction: "yes", confidence: 50, odds: 2.95 } },
      actualResults: {},
      scored: {},
    },
  ],
};
const riskyReco = generateRecommendedBatch(riskyBatch, [riskyBatch], coldAnalysis, defaultSettings);
assert.equal(riskyReco, null);

// One leg per match: pick higher score
const multiBatch: PredictionBatch = {
  id: "multi",
  date: "2026-06-06",
  league: "Premier League",
  batchName: "Multi market",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "mm1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: {
        btts: { prediction: "yes", confidence: 55, odds: 2.5 },
        "1x2": { prediction: "home", confidence: 80, odds: 1.55 },
      },
      actualResults: {},
      scored: {},
    },
  ],
};
const multiReco = generateRecommendedBatch(multiBatch, [multiBatch], coldAnalysis, defaultSettings);
assert.ok(multiReco);
const multiKeys = Object.keys(multiReco!.matches[0]!.predictions);
assert.equal(multiKeys.length, 1);
assert.ok(multiReco!.matches[0]!.predictions["1x2"], "should prefer higher-confidence 1x2 leg");

// Engine v3 — batch size is risk-driven in UI, not capped in selection
assert.equal(RECO_ENGINE_VERSION, 5);

// gameList covers all entered matches
assert.ok(coldReco!.gameList);
assert.equal(coldReco!.gameList.length, coldBatch.matches.length);
assert.equal(coldReco!.engineVersion, RECO_ENGINE_VERSION);

// Fine odds buckets
assert.equal(oddsToFineBucket(1.75), "1.60-1.80");
const fineRows: ScoredRow[] = Array.from({ length: 6 }, (_, i) => ({
  batchId: "fb",
  batchName: "FB",
  league: "PL",
  date: "2026-01-01",
  homeTeam: `H${i}`,
  awayTeam: `A${i}`,
  market: "btts" as const,
  prediction: "yes",
  confidence: 60,
  odds: 1.75,
  actual: i < 1 ? "yes" : "no",
  result: (i < 1 ? "correct" : "wrong") as "correct" | "wrong",
}));
const fineBuckets = computeFineOddsBuckets(fineRows);
const worst = detectWorstOddsBuckets(fineBuckets, 3);
assert.ok(worst.includes("1.60-1.80"));

// Similarity < 60 excludes from selected slip but appears in gameList as skip
function lowSimOddsAnalysis() {
  const oa = emptyOddsAnalysis();
  const bandStat = {
    band: "1.51-2.00" as const,
    total: 10,
    wins: 10,
    losses: 0,
    pushes: 0,
    winRate: 100,
    avgWinOdds: 1.65,
    avgLossOdds: null,
    valueScore: null,
    lowSample: false,
  };
  oa.bands["1.51-2.00"] = bandStat;
  oa.recentBands["1.51-2.00"] = { ...bandStat };
  return oa;
}
const lowSimBatch: PredictionBatch = {
  id: "lowsim",
  date: "2026-06-08",
  league: "Premier League",
  batchName: "Low similarity",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "ls1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { btts: { prediction: "yes", confidence: 55, odds: 2.35 } },
      actualResults: {},
      scored: {},
    },
    {
      id: "ls2",
      homeTeam: "Liverpool",
      awayTeam: "Spurs",
      predictions: { corners_ou: { prediction: "over", line: 9.5, confidence: 85, odds: 1.65 } },
      actualResults: {},
      scored: {},
    },
  ],
};
const lowSimAnalysis: AnalysisHistory = {
  schemaVersion: 3,
  updatedAt: new Date().toISOString(),
  totalScored: 50,
  marketAccuracy: {
    btts: { correct: 4, wrong: 6, push: 0, pct: 40 },
    corners_ou: { correct: 7, wrong: 3, push: 0, pct: 70 },
  },
  leagueAccuracy: {
    "Premier League": {
      btts: { correct: 4, wrong: 6, push: 0, pct: 40 },
      corners_ou: { correct: 7, wrong: 3, push: 0, pct: 70 },
    },
  },
  highConfidenceAccuracy: { correct: 5, wrong: 5, push: 0, pct: 50 },
  recentForm: { correct: 5, wrong: 5, push: 0, pct: 50 },
  topMarkets: [],
  weakestMarkets: [],
  calibrationNote: "",
  oddsAnalysis: lowSimOddsAnalysis(),
};
const lowSimReco = generateRecommendedBatch(lowSimBatch, [lowSimBatch], lowSimAnalysis, defaultSettings);
assert.ok(lowSimReco);
assert.equal(lowSimReco!.gameList.length, 2);
const skippedEntry = lowSimReco!.gameList.find((g) => g.judgment === "skip");
assert.ok(skippedEntry, "at least one match should be skip in gameList");
if (skippedEntry) {
  assert.ok(!lowSimReco!.matches.some((m) => m.id === skippedEntry.matchId));
  assert.ok(
    skippedEntry.skipReason?.includes("Similarity") ||
      skippedEntry.skipReason?.includes("Market win rate") ||
      skippedEntry.evidence.some((e) => e.sample >= 5)
  );
}

// Strong Keep vs Keep with caution labels
const cautionEntry = coldReco!.gameList.find((g) => g.selected);
assert.ok(cautionEntry);
assert.ok(["strong_keep", "keep_caution"].includes(cautionEntry!.judgment));

// Export includes game list columns
const exportBatch: PredictionBatch = {
  ...coldBatch,
  recommended: coldReco!,
};
const dualCsv = buildExportCsv([exportBatch]);
assert.ok(dualCsv.includes("original"));
assert.ok(dualCsv.includes("recommended"));
assert.ok(dualCsv.includes("combinedOdds"));
assert.ok(dualCsv.includes("riskLevel"));

const compCsv = buildComparisonCsv([exportBatch]);
assert.ok(compCsv.includes("originalPrediction"));
assert.ok(compCsv.includes("includedInRecommended"));
assert.ok(compCsv.includes("similarityScore"));
assert.ok(compCsv.includes("matchJudgment"));
assert.ok(compCsv.includes("evidenceSummary"));

// Dual scoring for recommended
const scoredWithReco = scoreBatch({
  ...batch,
  recommended: {
    displayName: "Test - Recommended",
    generatedAt: new Date().toISOString(),
    engineVersion: 1,
    acceptAll: false,
    matches: [
      {
        id: "m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        predictions: {
          "1x2": {
            prediction: "home",
            confidence: 70,
            odds: 1.75,
            action: "keep",
            judgment: "ok",
            accepted: false,
          },
        },
      },
    ],
    summary: {
      totalCombinedOdds: 1.75,
      riskLevel: "low",
      matchesIncluded: 1,
      matchesDropped: 0,
      summaryJudgment: "test",
      exclusions: [],
    },
    gameList: [],
  },
});
assert.equal(scoredWithReco.matches[0]!.recommendedScored?.["1x2"], "correct");

// Club profiles recompute from scored batches
import { recomputeClubProfiles, clubProfileId, getClubProfile } from "./club-profiles";
import { buildExportJson } from "./export";
import { recomputeLearnerStats, isWeakOddsBandForLearner } from "./ai-learner";
import { generateLearnerRecommendedBatch } from "./learner-recommendations";
import { recomputeTeamCharacteristics, teamCharacteristicsId } from "./team-characteristics";

const profileBatch: PredictionBatch = {
  id: "prof1",
  date: "2026-06-10",
  league: "Premier League",
  batchName: "Profile build",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "pm1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: {
        btts: { prediction: "yes", confidence: 70, odds: 1.85 },
        "1x2": { prediction: "home", confidence: 75, odds: 1.9 },
      },
      actualResults: {
        btts: { actual: "yes" },
        "1x2": { actual: "home" },
      },
      scored: { btts: "correct", "1x2": "correct" },
    },
    {
      id: "pm2",
      homeTeam: "Arsenal",
      awayTeam: "Liverpool",
      predictions: { btts: { prediction: "yes", confidence: 65, odds: 1.75 } },
      actualResults: { btts: { actual: "no" } },
      scored: { btts: "wrong" },
    },
  ],
};

const store = recomputeClubProfiles([profileBatch]);
const arsenal = getClubProfile(store, "Premier League", "Arsenal");
assert.ok(arsenal);
assert.equal(arsenal!.clubName, "Arsenal");
assert.ok(arsenal!.metrics.btts.sample >= 2);
assert.ok(arsenal!.recentMatches.length >= 1);
assert.ok(clubProfileId("Premier League", "Arsenal").includes("Arsenal"));

const exportWithProfiles = buildExportJson([profileBatch], analysis, store);
assert.ok(exportWithProfiles.includes("clubProfiles"));
assert.ok(exportWithProfiles.includes("Arsenal"));

// AI Learner — learns from odds ranges and batch patterns
const learnerHistory: PredictionBatch[] = [];
for (let i = 0; i < 12; i++) {
  const win = i % 3 !== 0;
  learnerHistory.push({
    id: `lb${i}`,
    date: `2026-05-${String(i + 1).padStart(2, "0")}`,
    league: "Premier League",
    batchName: `Learner batch ${i}`,
    createdAt: new Date().toISOString(),
    matches: [
      {
        id: `lm${i}`,
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        predictions: {
          "1x2": {
            prediction: "home",
            confidence: 70,
            odds: i < 8 ? 2.55 : 1.55,
          },
        },
        actualResults: { "1x2": { actual: win ? "home" : "away" } },
        scored: { "1x2": win ? "correct" : "wrong" },
      },
    ],
  });
}

const learnerStats = recomputeLearnerStats(learnerHistory, analysis, store);
assert.ok(learnerStats.totalScoredPicks >= 12);
assert.ok(learnerStats.oddsRanges.some((r) => r.sample > 0));
assert.ok(learnerStats.advice.topReliableRanges.length > 0 || learnerStats.weakestRanges.length > 0);

const weakBand = learnerStats.weakestRanges[0];
if (weakBand) {
  const weakCheck = isWeakOddsBandForLearner(
    weakBand === "2.51-3.00" ? 2.6 : 1.55,
    learnerStats
  );
  assert.ok(typeof weakCheck.weak === "boolean");
}

const newBatch: PredictionBatch = {
  id: "new-learner",
  date: "2026-06-01",
  league: "Premier League",
  batchName: "New learner test",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "nm1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { "1x2": { prediction: "home", confidence: 75, odds: 2.55 } },
      actualResults: {},
      scored: {},
    },
    {
      id: "nm2",
      homeTeam: "Liverpool",
      awayTeam: "Spurs",
      predictions: { btts: { prediction: "yes", confidence: 70, odds: 1.75 } },
      actualResults: {},
      scored: {},
    },
    {
      id: "nm3",
      homeTeam: "Man City",
      awayTeam: "Newcastle",
      predictions: { "1x2": { prediction: "home", confidence: 80, odds: 1.55 } },
      actualResults: {},
      scored: {},
    },
    {
      id: "nm4",
      homeTeam: "Brighton",
      awayTeam: "West Ham",
      predictions: { btts: { prediction: "yes", confidence: 65, odds: 1.9 } },
      actualResults: {},
      scored: {},
    },
    {
      id: "nm5",
      homeTeam: "Aston Villa",
      awayTeam: "Everton",
      predictions: { "1x2": { prediction: "home", confidence: 72, odds: 2.1 } },
      actualResults: {},
      scored: {},
    },
  ],
};

const learnerAnalysis = recomputeAnalysis(learnerHistory);
const learnerReco = generateLearnerRecommendedBatch(
  newBatch,
  [...learnerHistory, newBatch],
  learnerAnalysis,
  defaultRecommendationSettings(),
  store,
  learnerStats,
  recomputeTeamCharacteristics(learnerHistory)
);
assert.ok(learnerReco);
assert.equal(learnerReco!.learnerGenerated, true);
assert.ok(learnerReco!.matches.length <= 4);
assert.ok(learnerReco!.matches.every((m) => Object.values(m.predictions)[0]?.learnerLabel));

const exportWithLearner = buildExportJson([profileBatch], analysis, store, learnerStats);
assert.ok(exportWithLearner.includes("learnerStats"));

// Team characteristics from saved actuals
const tcBatch: PredictionBatch = {
  id: "tc1",
  date: "2026-06-10",
  league: "Premier League",
  batchName: "TC batch",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "tcm1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: {
        home_goals_ou: { prediction: "over", line: 0.5, confidence: 70, odds: 1.8 },
        away_goals_ou: { prediction: "over", line: 0.5, confidence: 65, odds: 2.0 },
        shots_ou: { prediction: "over", line: 20.5, confidence: 60, odds: 1.9 },
      },
      actualResults: {
        home_goals_ou: { actual: 2 },
        away_goals_ou: { actual: 1 },
        shots_ou: { actual: 22 },
        "1x2": { actual: "home" },
      },
      scored: {},
    },
  ],
};

const tcStore = recomputeTeamCharacteristics([tcBatch]);
const arsenalTc = tcStore.teams[teamCharacteristicsId("Premier League", "Arsenal")];
assert.ok(arsenalTc);
assert.equal(arsenalTc!.goals.goalsScoredAvg, 2);
assert.equal(arsenalTc!.goals.goalsConcededAvg, 1);
assert.ok(arsenalTc!.attacking.shotVolume > 0);

const exportWithTc = buildExportJson([tcBatch], analysis, store, learnerStats, tcStore);
assert.ok(exportWithTc.includes("teamCharacteristics"));

// Lucky numbers
const lucky = parseLuckyNumbersInput("7, 13, 7 23");
assert.deepEqual(lucky, [7, 13, 23]);
assert.equal(oddsMatchesLuckyNumber(2.07, [7]), true);
assert.equal(oddsMatchesLuckyNumber(1.85, [7]), false);
assert.ok(luckyInfluenceNote(2.07, [7])?.includes("7"));

const patterns = computeLearnerPatterns(
  [profileBatch, tcBatch],
  analysis,
  learnerStats,
  tcStore,
  [7]
);
assert.ok(patterns.topMarkets.length >= 0);
assert.ok(overallWinRate(learnerStats) === null || overallWinRate(learnerStats)! >= 0);

const baBatch: PredictionBatch = {
  id: "ba1",
  date: "2026-06-11",
  league: "Premier League",
  batchName: "BA test",
  createdAt: new Date().toISOString(),
  matches: [
    {
      id: "ba-m1",
      homeTeam: "A",
      awayTeam: "B",
      predictions: { "1x2": { prediction: "home", confidence: 70, odds: 1.5 } },
      actualResults: { "1x2": { actual: "home" } },
      scored: { "1x2": "correct" },
    },
    {
      id: "ba-m2",
      homeTeam: "C",
      awayTeam: "D",
      predictions: { "1x2": { prediction: "away", confidence: 65, odds: 2.0 } },
      actualResults: { "1x2": { actual: "home" } },
      scored: { "1x2": "wrong" },
    },
  ],
};
const batchRow = analyzeBatch(baBatch);
assert.equal(batchRow.batchWon, false);
assert.ok(batchRow.breakingLeg);
assert.equal(batchRow.breakingLeg!.homeTeam, "C");
assert.equal(analyzeAllBatches([baBatch]).length, 1);

// Club-centric KV — history mapper, capacity, comparison
import { mapMatchPredictionsToWrites } from "./history-mapper";
import { recomputeCapacity } from "./club-capacity";
import { compareClubs } from "./club-comparison";
import { createClubRecord } from "./club-record-types";

const mapMatch: LogMatch = {
  id: "m-map",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: {
    "1x2": { prediction: "home", confidence: 70, odds: 1.9 },
    btts: { prediction: "yes", confidence: 65, odds: 1.75 },
  },
  actualResults: {},
  scored: {},
};

const mapped = mapMatchPredictionsToWrites(
  mapMatch,
  "b1",
  "2026-06-01",
  "club_arsenal_001",
  "club_chelsea_001",
  "Arsenal",
  "Chelsea"
);
assert.ok(mapped.home.some((w) => w.type === "winLose" && w.predicted === "win"));
assert.ok(mapped.away.some((w) => w.type === "winLose" && w.predicted === "lose"));
assert.ok(mapped.home.some((w) => w.type === "bothTeamsScore"));

const capRecord = createClubRecord("club_a", "Alpha", "Premier League");
for (let i = 0; i < 6; i++) {
  capRecord.histories.winLose.push({
    id: `wl${i}`,
    date: `2026-05-${String(i + 1).padStart(2, "0")}`,
    batchId: "b",
    matchId: `m${i}`,
    opponentId: "club_b",
    opponentName: "Beta",
    venue: i % 2 === 0 ? "home" : "away",
    predicted: "win",
    actual: i < 4 ? "win" : "lose",
    result: i < 4 ? "hit" : "miss",
  });
}
capRecord.capacity = recomputeCapacity(capRecord);
assert.ok(capRecord.capacity.winRate >= 50);
assert.ok(capRecord.capacity.recentForm >= 0 && capRecord.capacity.recentForm <= 10);
assert.ok(capRecord.capacity.predictionAccuracyByType.winLose != null);

const clubA = createClubRecord("club_a", "Alpha", "Premier League");
const clubB = createClubRecord("club_b", "Beta", "Premier League");
clubA.capacity = { ...recomputeCapacity(clubA), homeWinRate: 60, awayWinRate: 40, sampleSize: 1, lowSample: true };
clubB.capacity = { ...recomputeCapacity(clubB), homeWinRate: 35, awayWinRate: 55, sampleSize: 1, lowSample: true };
const cmp = compareClubs(clubA, clubB, "home", "winLose");
assert.ok(cmp.lowDataWarning);
assert.ok(cmp.risky);
assert.ok(cmp.confidence >= 5 && cmp.confidence <= 95);
assert.ok(cmp.judgement.length > 0);

// --- Dynamic batch risk ---
assert.equal(batchRiskBand(30), "safe");
assert.equal(batchRiskBand(50), "caution");
assert.equal(batchRiskBand(70), "high");

function makeScoredHistoryBatch(
  id: string,
  legOdds: number[],
  allWon: boolean
): PredictionBatch {
  return {
    id,
    date: "2026-01-01",
    league: "Premier League",
    batchName: id,
    createdAt: new Date().toISOString(),
    matches: legOdds.map((odds, i) => ({
      id: `${id}-m${i}`,
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { btts: { prediction: "yes", confidence: 70, odds } },
      actualResults: { btts: { actual: allWon ? "yes" : "no" } },
      scored: { btts: (allWon ? "correct" : "wrong") as "correct" | "wrong" },
    })),
  };
}

const losingOddsHistory = [
  makeScoredHistoryBatch("lh1", [1.4, 1.4], false),
  makeScoredHistoryBatch("lh2", [1.4, 1.4], false),
  makeScoredHistoryBatch("lh3", [1.4, 1.4], false),
];
const winningOddsHistory = [
  makeScoredHistoryBatch("wh1", [1.4, 1.4], true),
  makeScoredHistoryBatch("wh2", [1.4, 1.4], true),
  makeScoredHistoryBatch("wh3", [1.4, 1.4], true),
];

const testLegs: ActiveLeg[] = [
  {
    matchId: "live1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    marketKey: "btts",
    odds: 1.4,
  },
  {
    matchId: "live2",
    homeTeam: "Liverpool",
    awayTeam: "Spurs",
    marketKey: "btts",
    odds: 1.4,
  },
];

const highOddsRisk = computeBatchRisk(testLegs, {
  batches: losingOddsHistory,
  analysis: coldAnalysis,
});
const lowOddsRisk = computeBatchRisk(testLegs, {
  batches: winningOddsHistory,
  analysis: coldAnalysis,
});
assert.ok(highOddsRisk.totalOddsRisk > lowOddsRisk.totalOddsRisk);

const losingSizeHistory = Array.from({ length: 3 }, (_, i) =>
  makeScoredHistoryBatch(`sz${i}`, [1.5, 1.5, 1.5, 1.5, 1.5], false)
);
const sizeLegs: ActiveLeg[] = Array.from({ length: 5 }, (_, i) => ({
  matchId: `s${i}`,
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  marketKey: "btts" as const,
  odds: 1.5,
}));
const highSizeRisk = computeBatchRisk(sizeLegs, {
  batches: losingSizeHistory,
  analysis: coldAnalysis,
});
assert.ok(highSizeRisk.batchLoseHistoryRisk >= 50);

const manyLegs: ActiveLeg[] = Array.from({ length: 8 }, (_, i) => ({
  matchId: `r${i}`,
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  marketKey: "btts" as const,
  odds: 1.55,
}));
function makeLargeLostBatch(id: string): PredictionBatch {
  return {
    id,
    date: "2026-01-01",
    league: "Premier League",
    batchName: id,
    createdAt: new Date().toISOString(),
    matches: Array.from({ length: 8 }, (_, i) => ({
      id: `${id}-m${i}`,
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { btts: { prediction: "yes", confidence: 70, odds: 1.55 } },
      actualResults: { btts: { actual: "no" } },
      scored: { btts: "wrong" as const },
    })),
  };
}
const highRiskCtx = {
  batches: [
    makeLargeLostBatch("big1"),
    makeLargeLostBatch("big2"),
    makeLargeLostBatch("big3"),
  ],
  analysis: coldAnalysis,
};
const highRisk = computeBatchRisk(manyLegs, highRiskCtx);
assert.equal(highRisk.band, "high");
const steps = computeReductionPlan(manyLegs, highRiskCtx);
assert.ok(steps.length > 0);
assert.ok(steps[0]!.riskAfter < steps[0]!.riskBefore);

// --- Master Probability Formula tests ---

// Confidence band boundaries
assert.equal(confidenceBand(75), "strong");
assert.equal(confidenceBand(80), "strong");
assert.equal(confidenceBand(74), "solid");
assert.equal(confidenceBand(60), "solid");
assert.equal(confidenceBand(59), "coin_flip");
assert.equal(confidenceBand(50), "coin_flip");
assert.equal(confidenceBand(49), "avoid");
assert.equal(confidenceBand(30), "avoid");

// Signal 1: Capacity edge returns 0.5 with no data
const noDataCap = computeCapacityEdge(null, null, "home", "btts");
assert.equal(noDataCap.value, 0.5);
assert.equal(noDataCap.reliability, 0);

// Capacity edge with data — home team stronger produces > 0.5
const strongCap = { ...emptyCapacity(), avgGoalsScored: 2.5, avgGoalsConceded: 0.5, sampleSize: 10 };
const weakCap = { ...emptyCapacity(), avgGoalsScored: 0.5, avgGoalsConceded: 2.0, sampleSize: 10 };
const capResult = computeCapacityEdge(strongCap, weakCap, "home", "btts");
assert.ok(capResult.value > 0.5);
assert.equal(capResult.reliability, 1);

// Signal 2: Form returns 0.5 with no data
const noForm = computeFormSignal(null, null);
assert.equal(noForm.value, 0.5);
assert.equal(noForm.reliability, 0);

// Form signal with good home form and poor away form
const goodFormCap = { ...emptyCapacity(), recentForm: 9, sampleSize: 8 };
const poorFormCap = { ...emptyCapacity(), recentForm: 2, sampleSize: 8 };
const formResult = computeFormSignal(goodFormCap, poorFormCap);
assert.ok(formResult.value > 0.6);
assert.equal(formResult.reliability, 1);

// Signal 3: H2H returns 0.5 with no data
const h2hNoData = computeH2HSignal(null, null, "btts");
assert.equal(h2hNoData.value, 0.5);
assert.equal(h2hNoData.reliability, 0);

// Signal 4: Your accuracy returns 0.5 with no data
const youNoData = computeYourAccuracy(null, "btts");
assert.equal(youNoData.value, 0.5);
assert.equal(youNoData.reliability, 0);

// Your accuracy with data
const youWithData = computeYourAccuracy(
  { ...coldAnalysis, marketAccuracy: { btts: { correct: 7, wrong: 3, push: 0, pct: 70 } } },
  "btts"
);
assert.ok(Math.abs(youWithData.value - 0.7) < 0.01);
assert.ok(youWithData.reliability > 0);

// Signal 5: Lucky signal returns 0.5 with no match
const luckyNo = computeLuckySignal(1.85, [7]);
assert.equal(luckyNo.value, 0.5);
assert.equal(luckyNo.reliability, 0);

// Lucky signal with a match
const luckyYes = computeLuckySignal(2.07, [7]);
assert.ok(luckyYes.value > 0.5);
assert.equal(luckyYes.reliability, 1);

// Blending: all no-data -> 50
const allNoData = blendSignals({
  cap: { value: 0.5, reliability: 0 },
  form: { value: 0.5, reliability: 0 },
  h2h: { value: 0.5, reliability: 0 },
  you: { value: 0.5, reliability: 0 },
  luck: { value: 0.5, reliability: 0 },
  lineup: { value: 0.5, reliability: 0 },
});
assert.equal(allNoData, 50);

// Blending: strong signals push above 50
const strongSignals = blendSignals({
  cap: { value: 0.7, reliability: 1 },
  form: { value: 0.65, reliability: 1 },
  h2h: { value: 0.75, reliability: 0.5 },
  you: { value: 0.72, reliability: 1 },
  luck: { value: 0.55, reliability: 1 },
  lineup: { value: 0.5, reliability: 0 },
});
assert.ok(strongSignals > 60);
assert.ok(strongSignals < 80);

// Thin data pulls toward 50
const thinDataSignals = blendSignals({
  cap: { value: 0.9, reliability: 0.1 },
  form: { value: 0.5, reliability: 0 },
  h2h: { value: 0.5, reliability: 0 },
  you: { value: 0.5, reliability: 0 },
  luck: { value: 0.5, reliability: 0 },
  lineup: { value: 0.5, reliability: 0 },
});
assert.ok(thinDataSignals > 50);
assert.ok(thinDataSignals < 95);

// R_odds: below safe threshold -> 0
assert.equal(computeROdds(3), 0);
assert.equal(computeROdds(6), 0);
assert.ok(computeROdds(10) > 0);
assert.ok(computeROdds(26) === 1);

// R_batch: both zero -> 0
assert.equal(computeRBatch(0, 0), 0);
assert.ok(computeRBatch(0.5, 0.5) > 0);
assert.ok(computeRBatch(0.5, 0.5) < 1);

// P_final < P_signal when batch risk is non-zero
const pfNoRisk = computePFinal(70, 0);
assert.equal(pfNoRisk, 70);
const pfWithRisk = computePFinal(70, 0.5);
assert.ok(pfWithRisk < 70);
assert.ok(pfWithRisk > 0);

// R_loss: insufficient history returns 0
assert.equal(computeRLoss(3, []), 0);

// BatchRiskResult now includes rBatch and pFinalByMatch
const legsWithPSignal: ActiveLeg[] = [
  { matchId: "mp1", homeTeam: "A", awayTeam: "B", marketKey: "btts", odds: 1.5, pSignal: 65 },
  { matchId: "mp2", homeTeam: "C", awayTeam: "D", marketKey: "btts", odds: 1.5, pSignal: 70 },
];
const mpRisk = computeBatchRisk(legsWithPSignal, { batches: [], analysis: coldAnalysis });
assert.ok(mpRisk.rBatch >= 0);
assert.ok(mpRisk.pFinalByMatch["mp1"] != null);
assert.ok(mpRisk.pFinalByMatch["mp2"] != null);
assert.ok(mpRisk.batchConfidence != null);

// End-to-end: generateRecommendedBatch attaches pSignal
assert.ok(coldReco!.matches[0]!.predictions.btts!.pSignal != null);

// Unified best recommendation: ONE collapsed batch with frozen math
const bestResult = generateBestRecommendationBatch(
  bigBatch,
  [bigBatch],
  coldAnalysis,
  defaultSettings,
  false,
  emptyLearnerStats(),
  emptyTeamCharacteristicsStore(),
  null,
  null,
  null,
  []
);
const bestBatch = bestResult.best;
assert.ok(bestBatch);
assert.equal(bestBatch.batchKind, "recommended");
assert.equal(bestBatch.recommendationStatus, "PENDING");
assert.equal(bestBatch.sourceBatchId, bigBatch.id);
// No tier suffix on the unified recommendation id
assert.ok(/^REC-\d{8}-\d{3}$/.test(bestBatch.id));
assert.equal(bestBatch.recommendationTier, undefined);
assert.ok(bestBatch.recommended?.mathSnapshot);
assert.ok((bestBatch.recommended?.matches.length ?? 0) >= 1);

// Alternative-market toggle is carried into the frozen snapshot
const bestWithAlt = generateBestRecommendationBatch(
  weakBatch,
  [weakBatch],
  weakAnalysis,
  defaultSettings,
  false,
  emptyLearnerStats(),
  emptyTeamCharacteristicsStore(),
  null,
  null,
  null,
  []
).best;
const bestWithoutAlt = generateBestRecommendationBatch(
  weakBatch,
  [weakBatch],
  weakAnalysis,
  { ...defaultSettings, tier3AllowAlternativeMarkets: false },
  false,
  emptyLearnerStats(),
  emptyTeamCharacteristicsStore(),
  null,
  null,
  null,
  []
).best;
assert.equal(
  bestWithAlt.recommended?.mathSnapshot?.settingsSnapshot.tier3AllowAlternativeMarkets,
  true
);
assert.equal(
  bestWithoutAlt.recommended?.mathSnapshot?.settingsSnapshot.tier3AllowAlternativeMarkets,
  false
);

// Extended frozen snapshot: market comparison, system pick, better alternative, workflow
const extMath = bestBatch.recommended?.mathSnapshot;
assert.ok(extMath?.marketComparisonByMatch);
assert.ok(extMath?.systemPickByMatch);
assert.ok(extMath?.betterAlternativeByMatch);
assert.ok(extMath?.workflowLog && extMath.workflowLog.length > 0);
assert.ok(extMath?.reductionSteps != null);
assert.equal(extMath?.settingsSnapshot.betterAlternativeThresholdPct, 8);

const firstMatchId = bestBatch.recommended?.matches[0]?.id;
if (firstMatchId) {
  const comparison = extMath!.marketComparisonByMatch![firstMatchId];
  assert.ok(Array.isArray(comparison) && comparison.length > 0);
  const selectedEntry = comparison.find((e) => e.selected);
  assert.ok(selectedEntry);
  const betterAlt = extMath!.betterAlternativeByMatch![firstMatchId];
  assert.ok(betterAlt);
  if (betterAlt.isOptimal) {
    assert.ok(betterAlt.deltaPct < 8 || comparison.every((e) => e.pFinal <= selectedEntry!.pFinal + 8));
  } else {
    assert.ok(betterAlt.pFinal - (selectedEntry?.pFinal ?? 0) >= 8);
  }
}

// buildBetterAlternative unit: optimal when within threshold
const mockComparison = [
  { marketKey: "1x2" as const, marketLabel: "Match result", predictionLabel: "Home", pFinal: 67, selected: true },
  { marketKey: "double_chance" as const, marketLabel: "Double chance", predictionLabel: "1X", pFinal: 72, selected: false },
];
const withinThreshold = buildBetterAlternative(mockComparison, 8);
assert.ok(withinThreshold?.isOptimal);
const aboveThreshold = buildBetterAlternative(
  [
    { marketKey: "1x2" as const, marketLabel: "Match result", predictionLabel: "Home", pFinal: 67, selected: true },
    { marketKey: "double_chance" as const, marketLabel: "Double chance", predictionLabel: "1X", pFinal: 84, selected: false },
  ],
  8
);
assert.ok(aboveThreshold && !aboveThreshold.isOptimal);
assert.equal(aboveThreshold.marketLabel, "Double chance");
assert.equal(aboveThreshold.pFinal, 84);

// Team stats sync: per-side sums auto-fill O/U market actuals
const teamStatsMatch: LogMatch = {
  id: "ts1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: {
    corners_ou: { prediction: "over", line: 9.5, confidence: 60 },
    shots_ou: { prediction: "under", line: 20.5, confidence: 55 },
    throw_ins_ou: { prediction: "over", line: 40.5, confidence: 50 },
  },
  actualResults: {},
  scored: {},
  teamStats: {
    home: { corners: 6, totalShots: 10, throwIns: 22 },
    away: { corners: 5, totalShots: 8, throwIns: 20 },
  },
};
const syncedTeamStats = applyTeamStatsSync(teamStatsMatch);
assert.equal(syncedTeamStats.actualResults.corners_ou?.actual, 11);
assert.equal(syncedTeamStats.scored.corners_ou, "correct");
assert.equal(syncedTeamStats.actualResults.shots_ou?.actual, 18);
assert.equal(syncedTeamStats.scored.shots_ou, "correct");
assert.equal(syncedTeamStats.actualResults.throw_ins_ou?.actual, 42);
assert.equal(syncedTeamStats.scored.throw_ins_ou, "correct");

// Team stats sync: per-side home/away shots O/U
const sideShotsMatch: LogMatch = {
  id: "ts-side-shots",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: {
    home_shots_ou: { prediction: "over", line: 10.5, confidence: 60 },
    away_shots_ou: { prediction: "under", line: 12.5, confidence: 55 },
  },
  actualResults: {},
  scored: {},
  teamStats: {
    home: { totalShots: 14 },
    away: { totalShots: 9 },
  },
};
const syncedSideShots = applyTeamStatsSync(sideShotsMatch);
assert.equal(syncedSideShots.actualResults.home_shots_ou?.actual, 14);
assert.equal(syncedSideShots.scored.home_shots_ou, "correct");
assert.equal(syncedSideShots.actualResults.away_shots_ou?.actual, 9);
assert.equal(syncedSideShots.scored.away_shots_ou, "correct");

// Team stats sync: per-side home/away shots on target O/U
const sideSotMatch: LogMatch = {
  id: "ts-side-sot",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: {
    home_sot_ou: { prediction: "over", line: 2.5, confidence: 60 },
    away_sot_ou: { prediction: "under", line: 2.5, confidence: 55 },
  },
  actualResults: {},
  scored: {},
  teamStats: {
    home: { shotsOnTarget: 4 },
    away: { shotsOnTarget: 2 },
  },
};
const syncedSideSot = applyTeamStatsSync(sideSotMatch);
assert.equal(syncedSideSot.actualResults.home_sot_ou?.actual, 4);
assert.equal(syncedSideSot.scored.home_sot_ou, "correct");
assert.equal(syncedSideSot.actualResults.away_sot_ou?.actual, 2);
assert.equal(syncedSideSot.scored.away_sot_ou, "correct");

// Team stats sync: first half result auto-scores ht_1x2
const htMatch: LogMatch = {
  id: "ts2",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: {
    ht_1x2: { prediction: "home", confidence: 65 },
  },
  actualResults: {},
  scored: {},
  teamStats: {
    home: {},
    away: {},
    firstHalfResult: "home",
  },
};
const syncedHt = applyTeamStatsSync(htMatch);
assert.equal(syncedHt.actualResults.ht_1x2?.actual, "home");
assert.equal(syncedHt.scored.ht_1x2, "correct");

// Team stats sync: final score auto-fills goal-derived markets
const goalSyncMatch: LogMatch = {
  id: "ts-goals",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: {
    "1x2": { prediction: "home", confidence: 70 },
    btts: { prediction: "yes", confidence: 60 },
    home_goals_ou: { prediction: "over", line: 1.5, confidence: 65 },
    away_goals_ou: { prediction: "under", line: 1.5, confidence: 55 },
    double_chance: { prediction: "1x", confidence: 68 },
  },
  actualResults: {},
  scored: {},
  teamStats: {
    home: { goals: 2 },
    away: { goals: 1 },
  },
};
const syncedGoals = applyTeamStatsSync(goalSyncMatch);
assert.equal(syncedGoals.actualResults["1x2"]?.actual, "home");
assert.equal(syncedGoals.actualResults.btts?.actual, "yes");
assert.equal(syncedGoals.actualResults.home_goals_ou?.actual, 2);
assert.equal(syncedGoals.actualResults.away_goals_ou?.actual, 1);
assert.equal(syncedGoals.actualResults.double_chance?.actual, "1x");
assert.equal(syncedGoals.scored["1x2"], "correct");
assert.equal(syncedGoals.scored.btts, "correct");

const drawMatch: LogMatch = {
  ...goalSyncMatch,
  id: "ts-draw",
  predictions: {
    "1x2": { prediction: "draw", confidence: 40 },
    btts: { prediction: "no", confidence: 55 },
  },
  teamStats: {
    home: { goals: 0 },
    away: { goals: 0 },
  },
};
const syncedDraw = applyTeamStatsSync(drawMatch);
assert.equal(syncedDraw.actualResults["1x2"]?.actual, "draw");
assert.equal(syncedDraw.actualResults.btts?.actual, "no");

const partialGoalsMatch: LogMatch = {
  ...goalSyncMatch,
  id: "ts-partial",
  teamStats: {
    home: { goals: 2 },
    away: {},
  },
};
const syncedPartial = applyTeamStatsSync(partialGoalsMatch);
assert.equal(syncedPartial.actualResults["1x2"]?.actual, undefined);
assert.equal(syncedPartial.actualResults.btts?.actual, undefined);

const dcAwayMatch: LogMatch = {
  id: "ts-dc-away",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: {
    double_chance: { prediction: "x2", confidence: 60 },
  },
  actualResults: {},
  scored: {},
  teamStats: {
    home: { goals: 0 },
    away: { goals: 2 },
  },
};
const syncedDcAway = applyTeamStatsSync(dcAwayMatch);
assert.equal(syncedDcAway.actualResults.double_chance?.actual, "x2");
assert.equal(syncedDcAway.scored.double_chance, "correct");

// resolveResultForType reads per-team stats from teamStats
const resolveMatch: LogMatch = {
  id: "ts3",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: {
    corners_ou: { prediction: "over", line: 9.5, confidence: 60 },
  },
  actualResults: { corners_ou: { actual: 11 } },
  scored: { corners_ou: "correct" },
  teamStats: {
    home: { totalShots: 12, corners: 6 },
    away: { totalShots: 9, corners: 5 },
  },
};
assert.deepEqual(resolveResultForType(resolveMatch, "totalShots", "home"), {
  result: "hit",
  actual: 12,
});
assert.deepEqual(resolveResultForType(resolveMatch, "corners", "away"), {
  result: "hit",
  actual: 5,
});

const dedupDate = "2026-06-10";
const earlierBatch: PredictionBatch = {
  id: "dedup-a",
  date: dedupDate,
  league: "Premier League",
  batchName: "Saturday Slip A",
  createdAt: "2026-01-01T10:00:00.000Z",
  matches: [
    {
      id: "da1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { "1x2": { prediction: "home", confidence: 70, odds: 1.8 } },
      actualResults: {},
      scored: {},
    },
  ],
  recommended: {
    displayName: "Saturday Slip A – Recommended",
    generatedAt: "2026-01-01T11:00:00.000Z",
    engineVersion: RECO_ENGINE_VERSION,
    matches: [
      {
        id: "da1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        predictions: {
          "1x2": {
            prediction: "home",
            confidence: 70,
            odds: 1.8,
            action: "keep",
            judgment: "test",
            accepted: true,
          },
        },
      },
    ],
    acceptAll: false,
    summary: {
      totalCombinedOdds: 1.8,
      riskLevel: "low",
      matchesIncluded: 1,
      matchesDropped: 0,
      summaryJudgment: "test",
      exclusions: [],
    },
    gameList: [],
  },
};

const laterBatch: PredictionBatch = {
  id: "dedup-b",
  date: dedupDate,
  league: "Premier League",
  batchName: "Saturday Slip B",
  createdAt: "2026-01-02T10:00:00.000Z",
  matches: [
    {
      id: "db1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { "1x2": { prediction: "home", confidence: 72, odds: 1.85 } },
      actualResults: {},
      scored: {},
    },
    {
      id: "db2",
      homeTeam: "Liverpool",
      awayTeam: "Man City",
      predictions: { btts: { prediction: "yes", confidence: 68, odds: 1.7 } },
      actualResults: {},
      scored: {},
    },
  ],
};

const priorOccupied = collectPriorOccupiedMarkets(laterBatch, [earlierBatch, laterBatch]);
assert.ok(
  priorOccupied.keys.has(marketOccupancyKey("Arsenal", "Chelsea", "1x2")),
  "prior batch should occupy arsenal/chelsea 1x2"
);

const laterReco = generateRecommendedBatch(
  laterBatch,
  [earlierBatch, laterBatch],
  coldAnalysis,
  defaultSettings
);
assert.ok(laterReco);
const laterMarkets = laterReco!.matches.flatMap((match) =>
  Object.keys(match.predictions).map((key) =>
    marketOccupancyKey(match.homeTeam, match.awayTeam, key as import("./types").LogMarketKey)
  )
);
assert.ok(
  !laterMarkets.includes(marketOccupancyKey("Arsenal", "Chelsea", "1x2")),
  "second batch should not repeat arsenal/chelsea 1x2"
);
assert.ok(
  laterReco!.summary.summaryJudgment.includes("Saturday Slip A") ||
    laterReco!.summary.exclusions.some((entry) => isSameDateDedupReason(entry.reason)),
  "second batch recommendation should mention same-date duplicate"
);

const differentDateBatch: PredictionBatch = {
  ...laterBatch,
  id: "dedup-c",
  date: "2026-06-11",
  createdAt: "2026-01-03T10:00:00.000Z",
};
const differentDateReco = generateRecommendedBatch(
  differentDateBatch,
  [earlierBatch, differentDateBatch],
  coldAnalysis,
  defaultSettings
);
assert.ok(differentDateReco);
const differentDateMarkets = differentDateReco!.matches.flatMap((match) =>
  Object.keys(match.predictions).map((key) =>
    marketOccupancyKey(match.homeTeam, match.awayTeam, key as import("./types").LogMarketKey)
  )
);
assert.ok(
  differentDateMarkets.includes(marketOccupancyKey("Arsenal", "Chelsea", "1x2")),
  "different date should allow repeated fixture/market"
);

const tierDedupSource: PredictionBatch = {
  id: "tier-dedup-src",
  date: "2026-06-12",
  league: "Premier League",
  batchName: "Tier dedup source",
  createdAt: "2026-01-04T10:00:00.000Z",
  matches: [
    {
      id: "td1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: {
        "1x2": { prediction: "home", confidence: 75, odds: 1.7 },
        btts: { prediction: "yes", confidence: 70, odds: 1.8 },
      },
      actualResults: {},
      scored: {},
    },
    {
      id: "td2",
      homeTeam: "Liverpool",
      awayTeam: "Man City",
      predictions: {
        "1x2": { prediction: "draw", confidence: 72, odds: 3.2 },
        btts: { prediction: "yes", confidence: 71, odds: 1.75 },
      },
      actualResults: {},
      scored: {},
    },
  ],
};

const dedupBest = generateBestRecommendationBatch(
  tierDedupSource,
  [tierDedupSource],
  coldAnalysis,
  defaultSettings,
  false,
  emptyLearnerStats(),
  emptyTeamCharacteristicsStore(),
  null,
  null,
  null,
  []
).best;
assert.ok(dedupBest.recommended);

function occupiedFromRecommended(batch: PredictionBatch): string[] {
  return (batch.recommended?.matches ?? []).flatMap((match) =>
    Object.keys(match.predictions).map((key) =>
      marketOccupancyKey(match.homeTeam, match.awayTeam, key as import("./types").LogMarketKey)
    )
  );
}

// A single unified batch never repeats the same market twice within itself
const dedupOccupied = occupiedFromRecommended(dedupBest);
assert.equal(new Set(dedupOccupied).size, dedupOccupied.length);
assert.equal(dedupBest.date, "2026-06-12");

// Combined odds: scoring and selection
const comboGrid = [
  [0.1, 0.05, 0.02],
  [0.12, 0.15, 0.08],
  [0.18, 0.1, 0.05],
];
const comboGridSum = comboGrid.flat().reduce((a, b) => a + b, 0);
const comboNorm = comboGrid.map((row) => row.map((v) => v / comboGridSum));
assert.ok(jointProbPercent(comboNorm, (h, a) => h > a && h >= 1 && a >= 1) > 0);

assert.equal(
  scoreComboLeg("btts_no_under_2_5", { btts: { actual: "no" }, home_goals_ou: { actual: 1 }, away_goals_ou: { actual: 0 } }),
  "correct"
);
assert.equal(scoreComboAccumulator([
  { matchId: "a", comboId: "home_btts_yes", result: "correct" },
  { matchId: "b", comboId: "away_btts_yes", result: "wrong" },
]), false);

// One leg per match validation
const singleLeg: LogMatch = {
  id: "leg1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: { "1x2": { prediction: "home", confidence: 60, odds: 1.9 } },
  actualResults: {},
  scored: {},
};
assert.equal(validateMatchLeg(singleLeg), null);
assert.equal(validateMatchLeg({ ...singleLeg, predictions: {} }), "Select a market.");
assert.equal(
  validateMatchLeg({
    ...singleLeg,
    predictions: {
      "1x2": { prediction: "home", confidence: 60 },
      btts: { prediction: "yes", confidence: 50 },
    },
  }),
  "Only one single market allowed per match."
);
const comboLeg = switchMarketMode(singleLeg, "combined");
comboLeg.comboPick = { comboId: "home_btts_yes", odds: 2.0 };
assert.equal(validateMatchLeg(comboLeg), null);
const comboCandidate = buildComboEntryCandidate(comboLeg);
assert.ok(comboCandidate?.passesHardFilters);
assert.equal(comboCandidate?.legOdds, 2.0);

console.log("prediction-log tests passed");
