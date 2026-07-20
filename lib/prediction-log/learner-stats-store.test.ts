import assert from "node:assert/strict";
import { test } from "node:test";
import { flattenScoredRows } from "./analysis";
import {
  loadLearnerStatsStore,
  recomputeAndPersistLearnerStats,
  saveLearnerStatsStore,
} from "./learner-stats-store";
import { emptyLearnerStats } from "./ai-learner";
import { processBatchDecisions } from "./decision-maker";
import { defaultCombinedOddsSettings } from "./combo-settings";
import { batchHasScoredResults, batchNeedsResults } from "./scoring";
import type { PredictionBatch } from "./types";

function scoredTelegramBatch(): PredictionBatch {
  return {
    id: "tg-learn-1",
    date: "2026-07-10",
    league: "Premier League",
    batchName: "Telegram scored",
    createdAt: new Date().toISOString(),
    source: "telegram",
    ownerUserId: "user-tg-1",
    matches: [
      {
        id: "tm1",
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
    ],
  };
}

test("batchNeedsResults / batchHasScoredResults", () => {
  const scored = scoredTelegramBatch();
  assert.equal(batchHasScoredResults(scored), true);
  assert.equal(batchNeedsResults(scored), false);

  const pending: PredictionBatch = {
    ...scored,
    id: "tg-pending",
    matches: [
      {
        ...scored.matches[0]!,
        actualResults: {},
        scored: {},
      },
    ],
  };
  assert.equal(batchHasScoredResults(pending), false);
  assert.equal(batchNeedsResults(pending), true);
});

test("recomputeAndPersistLearnerStats includes scored telegram batch", async () => {
  const batch = scoredTelegramBatch();
  const rows = flattenScoredRows([batch]);
  assert.ok(rows.length >= 2, "telegram scored picks flatten into learner rows");

  const stats = await recomputeAndPersistLearnerStats([batch]);
  assert.ok(stats.totalScoredPicks >= 2);
  assert.ok(stats.oddsRanges.length > 0);

  const loaded = await loadLearnerStatsStore();
  assert.equal(loaded.totalScoredPicks, stats.totalScoredPicks);
  assert.ok(Date.parse(loaded.updatedAt) > 0);
});

test("processBatchDecisions accepts non-null learnerStats from store", async () => {
  const batch = scoredTelegramBatch();
  await recomputeAndPersistLearnerStats([batch]);
  const learnerStats = await loadLearnerStatsStore();
  assert.ok(learnerStats.totalScoredPicks > 0);

  const pending: PredictionBatch = {
    ...batch,
    id: "tg-decision",
    matches: [
      {
        id: "dm1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        predictions: {
          btts: { prediction: "yes", confidence: 70, odds: 1.85 },
        },
        actualResults: {},
        scored: {},
      },
    ],
  };

  const rows = processBatchDecisions({
    batch: pending,
    allBatches: [batch, pending],
    comboSettings: defaultCombinedOddsSettings(),
    analysis: null,
    teamsQuality: null,
    learnerStats,
  });
  assert.ok(rows.length >= 1);
  assert.ok(learnerStats.totalScoredPicks > 0);
  assert.ok(Array.isArray(learnerStats.oddsRanges));
});

test("saveLearnerStatsStore round-trip", async () => {
  const empty = emptyLearnerStats();
  empty.totalScoredPicks = 42;
  empty.updatedAt = "2099-01-01T00:00:00.000Z";
  await saveLearnerStatsStore(empty);
  const loaded = await loadLearnerStatsStore();
  assert.equal(loaded.totalScoredPicks, 42);
  assert.equal(loaded.updatedAt, "2099-01-01T00:00:00.000Z");
});
