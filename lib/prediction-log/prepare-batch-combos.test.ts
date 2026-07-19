import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchEligibleForComboView,
  ensureComboRecommendedShell,
  buildRecommendedMatchesForAllFixtures,
} from "./prepare-batch-combos";
import type { PredictionBatch } from "./types";

function sampleBatch(): PredictionBatch {
  return {
    id: "b1",
    date: "2026-07-19",
    league: "Premier League",
    batchName: "Sunday",
    createdAt: "2026-07-19T10:00:00.000Z",
    batchKind: "manual",
    matches: [
      {
        id: "m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        predictions: { btts: { prediction: "yes", confidence: 70, odds: 1.85 } },
        actualResults: {},
        scored: {},
      },
      {
        id: "m2",
        homeTeam: "Liverpool",
        awayTeam: "Everton",
        predictions: { "1x2": { prediction: "home", confidence: 60, odds: 1.7 } },
        actualResults: {},
        scored: {},
        comboPick: { comboId: "btts_yes_over_2_5", odds: 2.1 },
      },
    ],
  };
}

test("batchEligibleForComboView requires matches", () => {
  const b = sampleBatch();
  assert.equal(batchEligibleForComboView(b), true);
  assert.equal(batchEligibleForComboView({ ...b, matches: [] }), false);
});

test("ensureComboRecommendedShell covers every fixture", () => {
  const prepared = ensureComboRecommendedShell(sampleBatch());
  assert.ok(prepared.recommended);
  assert.equal(prepared.recommended!.matches.length, 2);
  assert.equal(prepared.recommended!.matches[0]!.homeTeam, "Arsenal");
  assert.equal(prepared.recommended!.matches[1]!.id, "m2");
  assert.equal(prepared.recommended!.comboPickByMatch?.["m2"], "btts_yes_over_2_5");
  assert.equal(prepared.recommended!.comboOddsByMatch?.["m2"], 2.1);
});

test("buildRecommendedMatchesForAllFixtures keeps existing recommended pick", () => {
  const batch = sampleBatch();
  batch.recommended = {
    displayName: "Reco",
    generatedAt: batch.createdAt,
    engineVersion: 5,
    matches: [
      {
        id: "m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        predictions: {
          btts: {
            prediction: "yes",
            confidence: 75,
            odds: 1.9,
            action: "keep",
            judgment: "kept",
            accepted: true,
          },
        },
      },
    ],
    acceptAll: true,
    summary: {
      totalCombinedOdds: null,
      riskLevel: "low",
      matchesIncluded: 1,
      matchesDropped: 0,
      summaryJudgment: "ok",
      exclusions: [],
    },
    gameList: [],
  };
  const matches = buildRecommendedMatchesForAllFixtures(batch);
  assert.equal(matches.length, 2);
  assert.equal(matches[0]!.predictions.btts?.confidence, 75);
  assert.ok(matches[1]!.predictions["1x2"] || matches[1]!.predictions.btts);
});
