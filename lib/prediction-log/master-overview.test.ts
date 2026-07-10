import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCalibratorFromBatches,
  buildGlobalCalibrationReport,
} from "./global-calibration";
import { applyCalibration } from "./stat-probability";
import { derivePickComment } from "./pick-comment";
import {
  dataCompletenessLevel,
  dataCompletenessPct,
} from "./data-completeness";
import type { LogMatch, PredictionBatch } from "./types";

function scoredBatch(
  confidence: number,
  result: "correct" | "wrong",
  id: string
): PredictionBatch {
  const homeGoals = result === "correct" ? 2 : 0;
  const awayGoals = result === "correct" ? 0 : 2;
  const match: LogMatch = {
    id: `m-${id}`,
    homeTeam: "A",
    awayTeam: "B",
    predictions: {
      "1x2": { prediction: "home", confidence, odds: 1.8 },
    },
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: homeGoals },
      away: { goals: awayGoals },
    },
  };
  return {
    id: `b-${id}`,
    date: "2025-09-15",
    league: "Premier League",
    batchName: "t",
    createdAt: "2025-09-15T12:00:00Z",
    matches: [match],
  };
}

test("global calibration report bins claimed vs hit rate", () => {
  const batches = [
    ...Array.from({ length: 12 }, (_, i) => scoredBatch(70, "correct", `c${i}`)),
    ...Array.from({ length: 8 }, (_, i) => scoredBatch(70, "wrong", `w${i}`)),
  ];
  const report = buildGlobalCalibrationReport(batches);
  assert.equal(report.sampleSize, 20);
  assert.ok(report.overallHitRatePct != null);
  assert.equal(report.overallHitRatePct, 60);
  assert.ok(report.bins.length > 0);
});

test("bin calibrator wires into applyCalibration", () => {
  const batches = [
    ...Array.from({ length: 15 }, (_, i) => scoredBatch(90, "wrong", `a${i}`)),
    ...Array.from({ length: 15 }, (_, i) => scoredBatch(90, "wrong", `b${i}`)),
  ];
  const cal = buildCalibratorFromBatches(batches);
  assert.ok(cal);
  const adjusted = applyCalibration(90, cal);
  assert.ok(adjusted < 90);
});

test("derivePickComment Good / Risky / Avoid", () => {
  const good = derivePickComment({
    selectedPFinal: 72,
    betterAlt: {
      marketKey: "1x2",
      marketLabel: "1X2",
      predictionLabel: "Home",
      pFinal: 72,
      deltaPct: 0,
      isOptimal: true,
    },
  });
  assert.equal(good.label, "good");

  const risky = derivePickComment({
    selectedPFinal: 65,
    betterAlt: {
      marketKey: "double_chance",
      marketLabel: "Double chance",
      predictionLabel: "1X",
      pFinal: 78,
      deltaPct: 13,
      isOptimal: false,
    },
  });
  assert.equal(risky.label, "risky");

  const avoidLow = derivePickComment({
    selectedPFinal: 42,
    betterAlt: null,
  });
  assert.equal(avoidLow.label, "avoid");

  const avoidDom = derivePickComment({
    selectedPFinal: 60,
    betterAlt: {
      marketKey: "btts",
      marketLabel: "BTTS",
      predictionLabel: "Yes",
      pFinal: 80,
      deltaPct: 20,
      isOptimal: false,
    },
  });
  assert.equal(avoidDom.label, "avoid");
});

test("data completeness levels", () => {
  assert.equal(dataCompletenessLevel(2), "low");
  assert.equal(dataCompletenessLevel(10), "warm");
  assert.equal(dataCompletenessLevel(25), "ready");
  assert.equal(dataCompletenessPct(10), 50);
});
