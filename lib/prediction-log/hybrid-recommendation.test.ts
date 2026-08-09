import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HYBRID_AI_MIN_SAMPLES,
  HYBRID_NEUTRAL_AI_SCORE,
  applyHybridToRecommendedPick,
  calculateHybridRecommendation,
  getAILearnerScore,
  hybridRecommendationLevel,
} from "./hybrid-recommendation";
import { emptyLearnerStats } from "./ai-learner";
import { PREDICTION_WEIGHTS, blendBadgeLabel } from "./prediction-weights";
import type { RecommendedPick } from "./types";

test("hybrid confidence is system score (no probability-level blend)", () => {
  const r = calculateHybridRecommendation(68, 60);
  // Anti-pattern removed: displayed % is system, not 0.6*68+0.4*60
  assert.equal(r.hybridConfidence, 68);
  assert.equal(r.aiLearnerScore, 60);
  assert.equal(r.systemCalculationScore, 68);
  assert.equal(r.aiContributionWeight, PREDICTION_WEIGHTS.manualAi);
  assert.equal(r.systemContributionWeight, PREDICTION_WEIGHTS.apiDb);
  assert.equal(r.blendSource, "api_only");
  assert.equal(r.recommendation, "STRONG");
  assert.ok(r.breakdownLabel.includes("System market %"));
});

test("insufficient AI samples defaults to neutral 50 (advisory only)", () => {
  const stats = emptyLearnerStats();
  stats.totalScoredPicks = HYBRID_AI_MIN_SAMPLES - 1;
  const ai = getAILearnerScore(stats, 1.85);
  assert.equal(ai.score, HYBRID_NEUTRAL_AI_SCORE);
  assert.equal(ai.aiNeutral, true);

  const hybrid = calculateHybridRecommendation(80, ai.score, {
    aiSamples: ai.samples,
    aiNeutral: ai.aiNeutral,
  });
  assert.equal(hybrid.hybridConfidence, 80);
  assert.equal(hybrid.recommendation, "STRONG");
});

test("recommendation levels map thresholds", () => {
  assert.equal(hybridRecommendationLevel(65), "STRONG");
  assert.equal(hybridRecommendationLevel(55), "MODERATE");
  assert.equal(hybridRecommendationLevel(54.9), "WEAK");
});

test("applyHybridToRecommendedPick sets hybrid fields from pFinal (system)", () => {
  const stats = emptyLearnerStats();
  stats.totalScoredPicks = 25;
  stats.oddsRanges = [
    { band: "1.51-2.00", wins: 15, losses: 10, winRate: 60, sample: 25 },
    { band: "1.00-1.50", wins: 0, losses: 0, winRate: null, sample: 0 },
    { band: "2.01-2.50", wins: 0, losses: 0, winRate: null, sample: 0 },
    { band: "2.51-3.00", wins: 0, losses: 0, winRate: null, sample: 0 },
  ];

  const pick: RecommendedPick = {
    prediction: "home",
    confidence: 70,
    odds: 1.85,
    action: "keep",
    judgment: "ok",
    accepted: true,
    pSignal: 72,
    pFinal: 68,
  };

  const out = applyHybridToRecommendedPick(pick, stats);
  assert.equal(out.systemCalculationScore, 68);
  assert.equal(out.aiLearnerScore, 60);
  assert.equal(out.hybridConfidence, 68);
  assert.equal(out.confidence, 68);
  assert.equal(out.hybridRecommendation, "STRONG");
  assert.equal(out.blendSource, "api_only");
  assert.ok(out.confidenceBreakdown?.includes(blendBadgeLabel("api_only")));
});

test("remove picks are left unchanged", () => {
  const pick: RecommendedPick = {
    prediction: "home",
    confidence: 40,
    action: "remove",
    judgment: "skip",
    accepted: false,
    pFinal: 40,
  };
  const out = applyHybridToRecommendedPick(pick, emptyLearnerStats());
  assert.equal(out.hybridConfidence, undefined);
  assert.equal(out.action, "remove");
});
