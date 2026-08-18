import assert from "node:assert/strict";
import { test } from "node:test";
import { winOneHalfProb } from "./win-one-half-probability";

test("winOneHalfProb home favourite when 1H skewed", () => {
  const pHome = winOneHalfProb(1.2, 0.4, 0.8, 0.5, "home");
  const pAway = winOneHalfProb(1.2, 0.4, 0.8, 0.5, "away");
  assert.ok(pHome > 0.5);
  assert.ok(pAway < 0.5);
  assert.ok(Math.abs(pHome + pAway - 1) < 0.05);
});

test("winOneHalfProb symmetric halves near 50/50 for equal teams", () => {
  const pHome = winOneHalfProb(0.6, 0.6, 0.6, 0.6, "home");
  const pAway = winOneHalfProb(0.6, 0.6, 0.6, 0.6, "away");
  assert.ok(Math.abs(pHome - pAway) < 0.02);
});
