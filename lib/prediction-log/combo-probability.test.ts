import assert from "node:assert/strict";
import { buildScoreMatrix, jointProbFromGrid, jointProbPercent } from "@/lib/predictor/score-matrix";
import { comboGridProbabilityPercent } from "./combo-markets-config";
import { computeComboPFinal } from "./combo-probability";
import { defaultCombinedOddsSettings } from "./combo-settings";
import { evaluateMatchCombos, buildComboAccumulator } from "./combo-selection";
import { scoreComboLeg } from "./combo-scoring";
import type { PredictionBatch, RecommendedPickMathSnapshot } from "./types";

// Peaked grid: home win + BTTS yes
const grid = [
  [0.05, 0.08, 0.04],
  [0.1, 0.12, 0.06],
  [0.15, 0.18, 0.08],
];
const total = grid.flat().reduce((a, b) => a + b, 0);
const normGrid = grid.map((row) => row.map((v) => v / total));

const homeBttsYes = jointProbFromGrid(
  normGrid,
  (h, a) => h > a && h >= 1 && a >= 1
);
assert.ok(homeBttsYes > 0);
assert.ok(jointProbFromGrid(normGrid, (h, a) => h > a && a === 0) > homeBttsYes);

// 0-0 heavy grid
const drawGrid = buildScoreMatrix(0.3, 0.3, -0.13, 4);
const drawBttsNo = jointProbPercent(drawGrid, (h, a) => h === a && (h === 0 || a === 0));
assert.ok(drawBttsNo > 0);

const mathSnapshot: RecommendedPickMathSnapshot = {
  signals: { capacityEdge: 0.55, recentForm: 0.6, headToHead: 0.5, yourAccuracy: 0.5, luckyNudge: 0.5 },
  reliability: { capacityEdge: 0.5, recentForm: 0.5, headToHead: 0.3, yourAccuracy: 0.4, luckyNudge: 0 },
  pSignal: 65,
  oddsUsed: 2,
};

const settings = defaultCombinedOddsSettings();
const comboResult = computeComboPFinal({
  combo: { id: "home_btts_yes", label: "Home Win + BTTS Yes", enabled: true, category: "result_goals" },
  grid: normGrid,
  mathSnapshot,
  rBatch: 0.2,
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  minSample: 4,
  settings,
});
assert.ok(comboResult && comboResult.pFinal > 0 && comboResult.pFinal <= comboResult.pGrid + 20);

const batch: PredictionBatch = {
  id: "combo-test",
  date: "2026-03-15",
  league: "Premier League",
  batchName: "Test",
  createdAt: new Date().toISOString(),
  batchKind: "recommended",
  recommendationTier: "balanced",
  matches: [
    {
      id: "m1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      predictions: { "1x2": { prediction: "home", confidence: 70 } },
      actualResults: {},
      scored: {},
    },
  ],
  recommended: {
    displayName: "Balanced",
    generatedAt: new Date().toISOString(),
    engineVersion: 5,
    tier: "balanced",
    matches: [
      {
        id: "m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        predictions: {
          "1x2": {
            prediction: "home",
            confidence: 70,
            action: "keep",
            judgment: "",
            accepted: true,
            mathSnapshot: {
              ...mathSnapshot,
              statLayer: {
                pCustom: 60,
                pStat: 62,
                pDc: 62,
                pMl: 58,
                scoreGrid: normGrid,
                lambdaHome: 1.4,
                lambdaAway: 1.1,
                calibrated: false,
              },
            },
          },
        },
      },
    ],
    acceptAll: true,
    summary: {
      totalCombinedOdds: 2,
      riskLevel: "low",
      matchesIncluded: 1,
      matchesDropped: 0,
      summaryJudgment: "",
      exclusions: [],
    },
    gameList: [],
    mathSnapshot: {
      totalCombinedOdds: 2,
      batchRiskScore: 10,
      batchRiskBand: "safe",
      rOdds: 0.1,
      rLoss: 0.1,
      rBatch: 0.15,
      averagePFinal: 65,
      lambda: 0.45,
      pFinalByMatch: { m1: 65 },
      settingsSnapshot: {
        oddsFilteringEnabled: true,
        tier1MinPFinal: 72,
        tier3MaxBatchRisk: 0.6,
        tier3AllowAlternativeMarkets: true,
        learnerEnabled: false,
        luckyNumbers: [],
        betterAlternativeThresholdPct: 8,
      },
    },
  },
};

const matchResult = evaluateMatchCombos(batch, batch.recommended!.matches[0]!, settings, "balanced");
assert.ok(matchResult.allEvaluated.length > 0);

assert.equal(scoreComboLeg("home_btts_yes", { "1x2": { actual: "home" }, btts: { actual: "yes" } }), "correct");
assert.equal(scoreComboLeg("home_btts_yes", { "1x2": { actual: "home" }, btts: { actual: "no" } }), "wrong");

console.log("combo-probability tests passed");
