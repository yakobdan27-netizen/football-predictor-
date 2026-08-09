import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveSampleSize,
  normalizeWeights,
  weightedMean,
} from "./decay-weights";

test("normalizeWeights sums to 1", () => {
  const w = normalizeWeights([1, 0.8, 0.64, 0.512]);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test("weightedMean with raw weights", () => {
  const m = weightedMean([2, 4], [1, 1]);
  assert.equal(m, 3);
});

test("ESS equals n for equal weights", () => {
  const w = normalizeWeights([1, 1, 1, 1]);
  assert.ok(Math.abs(effectiveSampleSize(w) - 4) < 1e-9);
});
