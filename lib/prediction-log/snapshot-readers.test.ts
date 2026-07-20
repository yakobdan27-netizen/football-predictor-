/**
 * Snapshot reader helpers — summary and analysis must read the same frozen fields.
 * Run: npx tsx lib/prediction-log/snapshot-readers.test.ts
 */
import assert from "node:assert/strict";
import {
  buildMatchSummaryRows,
  formatBetterAlternativeLine,
  formatSystemPickLine,
  getBatchDisplayId,
  resolveBatchByQuery,
  tierDisplayLabel,
} from "./snapshot-readers";
import type {
  FrozenBetterAlternative,
  PredictionBatch,
  RecommendedBatch,
} from "./types";

const betterAlt: FrozenBetterAlternative = {
  marketKey: "double_chance",
  marketLabel: "Double Chance",
  predictionLabel: "1X",
  pFinal: 84,
  deltaPct: 17,
  isOptimal: false,
};

const optimalAlt: FrozenBetterAlternative = {
  marketKey: "1x2",
  marketLabel: "Match result (1X2)",
  predictionLabel: "Home",
  pFinal: 67,
  deltaPct: 0,
  isOptimal: true,
};

const recommended: RecommendedBatch = {
  displayName: "Test Reco",
  generatedAt: "2026-07-16T00:00:00.000Z",
  engineVersion: 5,
  tier: "balanced",
  matches: [
    {
      id: "m1",
      homeTeam: "Arsenal",
      awayTeam: "Luton",
      predictions: {
        "1x2": {
          prediction: "home",
          confidence: 67,
          action: "keep",
          judgment: "keep",
          accepted: true,
          pFinal: 67,
        },
      },
    },
  ],
  acceptAll: true,
  summary: {
    totalCombinedOdds: 2.1,
    riskLevel: "low",
    matchesIncluded: 1,
    matchesDropped: 0,
    averagePFinal: 67,
    summaryJudgment: "ok",
    exclusions: [],
  },
  gameList: [],
  mathSnapshot: {
    totalCombinedOdds: 2.1,
    batchRiskScore: 12,
    batchRiskBand: "safe",
    rOdds: 0.1,
    rLoss: 0.1,
    rBatch: 0.1,
    averagePFinal: 67,
    lambda: 1,
    pFinalByMatch: { m1: 67 },
    systemPickByMatch: {
      m1: { outcome: "home", label: "Arsenal to win" },
    },
    betterAlternativeByMatch: { m1: betterAlt },
    marketComparisonByMatch: {
      m1: [
        {
          marketKey: "1x2",
          marketLabel: "Match result (1X2)",
          predictionLabel: "Home",
          pFinal: 67,
          selected: true,
        },
        {
          marketKey: "double_chance",
          marketLabel: "Double Chance",
          predictionLabel: "1X",
          pFinal: 84,
          selected: false,
        },
      ],
    },
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
};

const batch: PredictionBatch = {
  id: "internal-1",
  recommendationId: "REC-2026-0142",
  date: "2026-07-16",
  league: "EPL",
  batchName: "Reco",
  createdAt: "2026-07-16T00:00:00.000Z",
  batchKind: "recommended",
  recommendationTier: "safe",
  matches: [],
  recommended,
};

assert.equal(getBatchDisplayId(batch), "REC-2026-0142");
assert.equal(tierDisplayLabel("safe"), "Extreme Safe");
assert.equal(tierDisplayLabel("balanced"), "Balanced");
assert.equal(tierDisplayLabel("aggressive"), "Aggressive");

assert.equal(resolveBatchByQuery([batch], "REC-2026-0142")?.id, "internal-1");
assert.equal(resolveBatchByQuery([batch], "internal-1")?.id, "internal-1");
assert.equal(resolveBatchByQuery([batch], "missing"), null);

const rows = buildMatchSummaryRows(batch, recommended);
assert.equal(rows.length, 1);
assert.equal(formatSystemPickLine(rows[0].systemPick), "Arsenal to win");
assert.equal(rows[0].selectedPFinal, 67);
assert.equal(rows[0].selectedMarketLabel, "Match result (1X2)");

const altLine = formatBetterAlternativeLine(rows[0].betterAlternative);
assert.equal(altLine.isOptimal, false);
assert.ok(altLine.text.includes("84%"));
assert.equal(altLine.showArrow, true);

const optimalLine = formatBetterAlternativeLine(optimalAlt);
assert.equal(optimalLine.isOptimal, true);
assert.equal(optimalLine.text, "Selected market is optimal ✓");

// Summary + analysis parity: market comparison best matches betterAlternative
const markets = recommended.mathSnapshot!.marketComparisonByMatch!.m1;
const best = [...markets].sort((a, b) => b.pFinal - a.pFinal)[0];
assert.equal(best.pFinal, betterAlt.pFinal);
assert.equal(best.marketLabel, betterAlt.marketLabel);

console.log("snapshot-readers.test.ts: all assertions passed");
