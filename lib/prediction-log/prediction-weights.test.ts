import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PREDICTION_WEIGHTS,
  SYSTEM_SEASON_BLEND_WEIGHTS,
  blendBadgeLabel,
  weightedEstimate,
  weightedTripleEstimate,
} from "./prediction-weights";

test("blended uses 60/40 arithmetic", () => {
  const r = weightedEstimate(80, 50);
  assert.ok(r);
  assert.equal(r.source, "blended");
  assert.equal(r.value, 80 * PREDICTION_WEIGHTS.apiDb + 50 * PREDICTION_WEIGHTS.manualAi);
  assert.equal(r.apiWeight, 0.6);
  assert.equal(r.manualAiWeight, 0.4);
  assert.equal(blendBadgeLabel(r.source), "API 60% · Manual/AI 40%");
});

test("api-only fallback when manual missing", () => {
  const warn = console.warn;
  const msgs: string[] = [];
  console.warn = (...args: unknown[]) => {
    msgs.push(String(args[0]));
  };
  try {
    const r = weightedEstimate(72, null);
    assert.ok(r);
    assert.equal(r.source, "api_only");
    assert.equal(r.value, 72);
    assert.equal(r.apiWeight, 1);
    assert.equal(r.manualAiWeight, 0);
    assert.equal(blendBadgeLabel(r.source), "API only");
    assert.ok(msgs.some((m) => m.includes("manual/AI missing")));
  } finally {
    console.warn = warn;
  }
});

test("manual-ai-only fallback when API missing", () => {
  const warn = console.warn;
  const msgs: string[] = [];
  console.warn = (...args: unknown[]) => {
    msgs.push(String(args[0]));
  };
  try {
    const r = weightedEstimate(undefined, 55);
    assert.ok(r);
    assert.equal(r.source, "manual_ai_only");
    assert.equal(r.value, 55);
    assert.equal(r.apiWeight, 0);
    assert.equal(r.manualAiWeight, 1);
    assert.equal(blendBadgeLabel(r.source), "Manual/AI only");
    assert.ok(msgs.some((m) => m.includes("API-DB missing")));
  } finally {
    console.warn = warn;
  }
});

test("neither side returns null", () => {
  assert.equal(weightedEstimate(null, undefined), null);
  assert.equal(weightedEstimate(Number.NaN, Number.NaN), null);
});

test("triple blend uses 30/30/40 arithmetic", () => {
  const w = SYSTEM_SEASON_BLEND_WEIGHTS;
  const r = weightedTripleEstimate(90, 60, 50);
  assert.ok(r);
  assert.equal(r.source, "blended");
  assert.equal(
    r.value,
    w.recentLast5 * 90 + w.priorApi * 60 + w.systemSeason * 50
  );
  assert.equal(r.recentWeight, w.recentLast5);
  assert.equal(r.priorWeight, w.priorApi);
  assert.equal(r.systemWeight, w.systemSeason);
  assert.equal(r.apiWeight, w.recentLast5 + w.priorApi);
  assert.equal(r.manualAiWeight, w.systemSeason);
});

test("triple blend renormalizes when recent missing", () => {
  const r = weightedTripleEstimate(null, 60, 40);
  assert.ok(r);
  assert.equal(r.value, (0.3 / 0.7) * 60 + (0.4 / 0.7) * 40);
  assert.equal(r.recentWeight, 0);
  assert.ok(r.priorWeight > 0.4);
  assert.ok(r.systemWeight > 0.4);
});

test("triple blend neither API side falls back to system only", () => {
  const r = weightedTripleEstimate(null, null, 55);
  assert.ok(r);
  assert.equal(r.source, "manual_ai_only");
  assert.equal(r.value, 55);
});
