/**
 * Shared half-tempo helpers.
 * Run: npx tsx lib/prediction-log/half-tempo.test.ts
 */
import assert from "node:assert/strict";
import {
  applyHalfTempoNudges,
  emptyHalfTempoProfile,
  estimateTempoProfile,
} from "./half-tempo";
import type { PredictionBatch } from "./types";

{
  const empty = emptyHalfTempoProfile();
  const nudged = applyHalfTempoNudges(1.0, 1.2, empty, empty);
  assert.equal(nudged.tempoBoost1h, false);
  assert.equal(nudged.lateSurgeBoost2h, false);
  assert.equal(nudged.fatigueBoost2h, true);
  assert.ok(nudged.lambda2h > 1.2);
}

{
  const fast = {
    ...emptyHalfTempoProfile(),
    sampleWithTiming: 5,
    isFastStarter: true,
    fastStartRate: 0.5,
  };
  const late = {
    ...emptyHalfTempoProfile(),
    sampleWithTiming: 5,
    isLateSurger: true,
    lateSurgeRate: 0.4,
  };
  const nudged = applyHalfTempoNudges(1.0, 1.0, fast, late);
  assert.equal(nudged.tempoBoost1h, true);
  assert.equal(nudged.lateSurgeBoost2h, true);
  assert.ok(nudged.lambda1h > 1.0);
  assert.ok(nudged.lambda2h > 1.0);
}

{
  const batches: PredictionBatch[] = [];
  const tempo = estimateTempoProfile(batches, "Arsenal");
  assert.equal(tempo.sampleWithTiming, 0);
  assert.equal(tempo.isFastStarter, false);
}

console.log("half-tempo tests passed");
