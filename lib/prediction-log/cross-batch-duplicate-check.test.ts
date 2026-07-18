import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractPredictionLegs,
  findCrossBatchDuplicates,
  predictionOccupancyKey,
} from "./cross-batch-duplicate-check";
import type { LogMatch, PredictionBatch, RecommendedBatch } from "./types";

function baseMatch(overrides: Partial<LogMatch> = {}): LogMatch {
  return {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    predictions: {},
    actualResults: {},
    scored: {},
    ...overrides,
  };
}

function baseBatch(overrides: Partial<PredictionBatch> = {}): PredictionBatch {
  return {
    id: "b1",
    date: "2026-07-18",
    league: "Premier League",
    batchName: "Batch A",
    createdAt: "2026-07-18T10:00:00.000Z",
    batchKind: "manual",
    matches: [],
    ...overrides,
  };
}

test("predictionOccupancyKey includes fixture, market, prediction, and line", () => {
  const a = predictionOccupancyKey({
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    marketKey: "total_goals_ou",
    prediction: "Over",
    line: 2.5,
  });
  const b = predictionOccupancyKey({
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    marketKey: "total_goals_ou",
    prediction: "over",
    line: 2.5,
  });
  const c = predictionOccupancyKey({
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    marketKey: "total_goals_ou",
    prediction: "Over",
    line: 3.5,
  });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("same date + fixture + market + prediction is a duplicate", () => {
  const existing = baseBatch({
    id: "prior",
    batchName: "Morning",
    matches: [
      baseMatch({
        predictions: { btts: { prediction: "yes", confidence: 70, odds: 1.85 } },
      }),
    ],
  });
  const incoming = baseBatch({
    id: "new",
    batchName: "Evening",
    matches: [
      baseMatch({
        id: "m2",
        predictions: { btts: { prediction: "yes", confidence: 60, odds: 1.9 } },
      }),
    ],
  });
  const hits = findCrossBatchDuplicates({
    incomingBatch: incoming,
    allBatches: [existing, incoming],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.batchId, "prior");
  assert.equal(hits[0]!.batchName, "Morning");
  assert.equal(hits[0]!.prediction, "yes");
});

test("different prediction on same market is not a duplicate", () => {
  const existing = baseBatch({
    id: "prior",
    matches: [
      baseMatch({
        predictions: { "1x2": { prediction: "home", confidence: 70, odds: 1.8 } },
      }),
    ],
  });
  const incoming = baseBatch({
    id: "new",
    matches: [
      baseMatch({
        id: "m2",
        predictions: { "1x2": { prediction: "away", confidence: 60, odds: 3.2 } },
      }),
    ],
  });
  const hits = findCrossBatchDuplicates({
    incomingBatch: incoming,
    allBatches: [existing],
  });
  assert.equal(hits.length, 0);
});

test("different O/U line is not a duplicate", () => {
  const existing = baseBatch({
    id: "prior",
    matches: [
      baseMatch({
        predictions: {
          total_goals_ou: { prediction: "over", confidence: 70, odds: 1.9, line: 2.5 },
        },
      }),
    ],
  });
  const incoming = baseBatch({
    id: "new",
    matches: [
      baseMatch({
        id: "m2",
        predictions: {
          total_goals_ou: { prediction: "over", confidence: 70, odds: 1.9, line: 3.5 },
        },
      }),
    ],
  });
  const hits = findCrossBatchDuplicates({
    incomingBatch: incoming,
    allBatches: [existing],
  });
  assert.equal(hits.length, 0);
});

test("different date is not a duplicate", () => {
  const existing = baseBatch({
    id: "prior",
    date: "2026-07-17",
    matches: [
      baseMatch({
        predictions: { btts: { prediction: "yes", confidence: 70, odds: 1.85 } },
      }),
    ],
  });
  const incoming = baseBatch({
    id: "new",
    date: "2026-07-18",
    matches: [
      baseMatch({
        id: "m2",
        predictions: { btts: { prediction: "yes", confidence: 70, odds: 1.85 } },
      }),
    ],
  });
  const hits = findCrossBatchDuplicates({
    incomingBatch: incoming,
    allBatches: [existing],
  });
  assert.equal(hits.length, 0);
});

test("combo pick duplicate detection", () => {
  const existing = baseBatch({
    id: "prior",
    matches: [
      baseMatch({
        marketMode: "combined",
        comboPick: { comboId: "btts_yes_over_2_5", odds: 2.1 },
        predictions: {},
      }),
    ],
  });
  const incoming = baseBatch({
    id: "new",
    matches: [
      baseMatch({
        id: "m2",
        marketMode: "combined",
        comboPick: { comboId: "btts_yes_over_2_5", odds: 2.2 },
        predictions: {},
      }),
    ],
  });
  const hits = findCrossBatchDuplicates({
    incomingBatch: incoming,
    allBatches: [existing],
  });
  assert.equal(hits.length, 1);
  assert.ok(hits[0]!.marketLabel.length > 0);
});

test("correct-score duplicate detection", () => {
  const existing = baseBatch({
    id: "prior",
    matches: [
      baseMatch({
        correctScorePick: { home: 2, away: 1, odds: 8 },
        predictions: { btts: { prediction: "yes", confidence: 50, odds: 1.8 } },
      }),
    ],
  });
  const incoming = baseBatch({
    id: "new",
    matches: [
      baseMatch({
        id: "m2",
        correctScorePick: { home: 2, away: 1, odds: 7.5 },
        predictions: { "1x2": { prediction: "home", confidence: 50, odds: 1.7 } },
      }),
    ],
  });
  const hits = findCrossBatchDuplicates({
    incomingBatch: incoming,
    allBatches: [existing],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.prediction, "2-1");
  assert.equal(hits[0]!.marketLabel, "Correct score");
});

test("excludeBatchId excludes self when re-saving", () => {
  const existing = baseBatch({
    id: "same",
    matches: [
      baseMatch({
        predictions: { btts: { prediction: "yes", confidence: 70, odds: 1.85 } },
      }),
    ],
  });
  const hits = findCrossBatchDuplicates({
    incomingBatch: { ...existing, batchName: "Renamed" },
    allBatches: [existing],
    excludeBatchId: "same",
  });
  assert.equal(hits.length, 0);
});

test("recommended legs count as occupied exposure", () => {
  const recommended: RecommendedBatch = {
    displayName: "Reco",
    generatedAt: "2026-07-18T10:00:00.000Z",
    engineVersion: 1,
    matches: [
      {
        id: "rm1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        predictions: {
          btts: {
            prediction: "yes",
            confidence: 70,
            odds: 1.85,
            action: "keep",
            judgment: "ok",
            accepted: true,
          },
        },
      },
    ],
    acceptAll: true,
    gameList: [],
    summary: {
      totalCombinedOdds: 1.85,
      riskLevel: "low",
      matchesIncluded: 1,
      matchesDropped: 0,
      summaryJudgment: "ok",
      exclusions: [],
    },
  };
  const existing = baseBatch({
    id: "prior-reco",
    batchKind: "recommended",
    matches: [baseMatch({ id: "rm1" })],
    recommended,
  });
  const incoming = baseBatch({
    id: "new",
    matches: [
      baseMatch({
        id: "m2",
        predictions: { btts: { prediction: "yes", confidence: 60, odds: 1.9 } },
      }),
    ],
  });
  const hits = findCrossBatchDuplicates({
    incomingBatch: incoming,
    allBatches: [existing],
  });
  assert.equal(hits.length, 1);
});

test("extractPredictionLegs ignores empty predictions", () => {
  const batch = baseBatch({
    matches: [baseMatch({ predictions: { btts: { prediction: "", confidence: 50 } } })],
  });
  assert.equal(extractPredictionLegs(batch).length, 0);
});
