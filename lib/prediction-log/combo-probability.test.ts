import assert from "node:assert/strict";
import { buildScoreMatrix, jointProbFromGrid, jointProbPercent } from "@/lib/predictor/score-matrix";
import { comboGridProbabilityPercent, EXTENDED_COMBO_FAMILY_IDS } from "./combo-markets-config";
import { computeComboPFinal } from "./combo-probability";
import { defaultCombinedOddsSettings } from "./combo-settings";
import { evaluateBatchCombos, evaluateMatchCombos, buildComboAccumulator } from "./combo-selection";
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

// --- Section 2G "new combos" — grid-based joint probability, never multiplied ---

// Result + Total: Home Win + Over 2.5 -> sum grid[h][a] where h>a && h+a>=3
const homeOver25 = jointProbPercent(normGrid, (h, a) => h > a && h + a > 2.5);
assert.equal(comboGridProbabilityPercent("home_over_2_5", { grid: normGrid }), homeOver25);

// BTTS No + Total: BTTS No + Over 1.5 -> sum grid[h][a] where (h=0 or a=0) && h+a>=2
const bttsNoOver15 = jointProbPercent(normGrid, (h, a) => (h === 0 || a === 0) && h + a > 1.5);
assert.equal(comboGridProbabilityPercent("btts_no_over_1_5", { grid: normGrid }), bttsNoOver15);
const bttsNoUnder35 = jointProbPercent(normGrid, (h, a) => (h === 0 || a === 0) && h + a < 3.5);
assert.equal(comboGridProbabilityPercent("btts_no_under_3_5", { grid: normGrid }), bttsNoUnder35);

// Double Chance + BTTS Yes: 1X + BTTS Yes -> sum grid[h][a] where h>=a && h>=1 && a>=1 (already existed)
const dc1xBttsYes = jointProbPercent(normGrid, (h, a) => h >= a && h >= 1 && a >= 1);
assert.equal(comboGridProbabilityPercent("1x_btts_yes", { grid: normGrid }), dc1xBttsYes);

// Double Chance + Total: X2 + Under 3.5 (new) and 1X/X2/12 line variants
const x2Under35 = jointProbPercent(normGrid, (h, a) => a >= h && h + a < 3.5);
assert.equal(comboGridProbabilityPercent("x2_under_3_5", { grid: normGrid }), x2Under35);
const dcTwelveOver15 = jointProbPercent(normGrid, (h, a) => h !== a && h + a > 1.5);
assert.equal(comboGridProbabilityPercent("12_over_1_5", { grid: normGrid }), dcTwelveOver15);

// Every id referenced by the extended-page family filter must resolve to a real, evaluable combo.
for (const id of EXTENDED_COMBO_FAMILY_IDS) {
  const pct = comboGridProbabilityPercent(id, { grid: normGrid });
  assert.ok(pct != null, `EXTENDED_COMBO_FAMILY_IDS entry "${id}" did not resolve to a grid predicate`);
}

// Grading: new combo ids must score correctly from FT actuals.
assert.equal(
  scoreComboLeg("btts_no_over_1_5", { "1x2": { actual: "home" }, home_goals_ou: { actual: 2 }, away_goals_ou: { actual: 0 } }),
  "correct"
);
assert.equal(
  scoreComboLeg("btts_no_over_1_5", { "1x2": { actual: "home" }, home_goals_ou: { actual: 1 }, away_goals_ou: { actual: 1 } }),
  "wrong"
);
assert.equal(
  scoreComboLeg("12_under_3_5", { "1x2": { actual: "away" }, home_goals_ou: { actual: 1 }, away_goals_ou: { actual: 1 } }),
  "correct"
);
assert.equal(
  scoreComboLeg("12_under_3_5", { "1x2": { actual: "draw" }, home_goals_ou: { actual: 1 }, away_goals_ou: { actual: 1 } }),
  "wrong"
);

// evaluateBatchCombos: tier defaults to "balanced" (non-breaking) and accepts an explicit tier + comboFilter.
const defaultTierResult = evaluateBatchCombos(batch, settings, null, [batch]);
assert.ok(defaultTierResult.matches.length > 0);

const filteredResult = evaluateBatchCombos(
  batch,
  settings,
  null,
  [batch],
  undefined,
  undefined,
  "balanced",
  (combo) => EXTENDED_COMBO_FAMILY_IDS.includes(combo.id)
);
assert.ok(
  filteredResult.matches[0]!.allEvaluated.every((c) => EXTENDED_COMBO_FAMILY_IDS.includes(c.comboId)),
  "comboFilter must restrict evaluated combos to the extended family ids"
);

console.log("combo-probability tests passed");
