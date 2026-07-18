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
import type { RecommendedPick } from "./types";

test("50/50 weighting is mathematically correct", () => {
  const r = calculateHybridRecommendation(68, 60);
  assert.equal(r.hybridConfidence, 64);
  assert.equal(r.aiContribution, 30);
  assert.equal(r.systemContribution, 34);
  assert.equal(r.recommendation, "MODERATE");
  assert.equal(r.breakdownLabel, "AI: 30% | System: 34%");
});

test("insufficient AI samples defaults to neutral 50", () => {
  const stats = emptyLearnerStats();
  stats.totalScoredPicks = HYBRID_AI_MIN_SAMPLES - 1;
  const ai = getAILearnerScore(stats, 1.85);
  assert.equal(ai.score, HYBRID_NEUTRAL_AI_SCORE);
  assert.equal(ai.aiNeutral, true);

  const hybrid = calculateHybridRecommendation(80, ai.score, {
    aiSamples: ai.samples,
    aiNeutral: ai.aiNeutral,
  });
  // (50*0.5) + (80*0.5) = 65
  assert.equal(hybrid.hybridConfidence, 65);
  assert.equal(hybrid.recommendation, "STRONG");
});

test("recommendation levels map thresholds", () => {
  assert.equal(hybridRecommendationLevel(65), "STRONG");
  assert.equal(hybridRecommendationLevel(55), "MODERATE");
  assert.equal(hybridRecommendationLevel(54.9), "WEAK");
});

test("applyHybridToRecommendedPick sets hybrid fields from pFinal", () => {
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
  assert.equal(out.hybridConfidence, 64);
  assert.equal(out.confidence, 64);
  assert.equal(out.hybridRecommendation, "MODERATE");
  assert.ok(out.confidenceBreakdown?.includes("Hybrid 50/50"));
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
