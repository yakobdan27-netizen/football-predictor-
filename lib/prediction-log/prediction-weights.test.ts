import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PREDICTION_WEIGHTS,
  blendBadgeLabel,
  weightedEstimate,
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
