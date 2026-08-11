import assert from "node:assert/strict";
import {
  aggregateSampleWeightedMean,
  blendNumericKpi,
  combineCounts,
  computeBlendConfidence,
} from "./blend-math";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

const base = {
  apiWeight: 0.6,
  systemWeight: 0.4,
  fallbackMode: "legacy" as const,
};

test("exact 60/40 when both sides present and above mins", () => {
  const r = blendNumericKpi(10, 0, base, {
    apiRecordCount: 10,
    systemRecordCount: 10,
    minApiRecords: 5,
    minSystemRecords: 5,
  });
  assert.equal(r.status, "complete");
  assert.ok(r.value != null);
  assert.ok(Math.abs(r.value! - 6) < 1e-9);
  assert.equal(r.apiEffectiveWeight, 0.6);
  assert.equal(r.systemEffectiveWeight, 0.4);
});

test("missing system does not treat as zero — legacy fallback", () => {
  const r = blendNumericKpi(10, null, base, {
    apiRecordCount: 10,
    systemRecordCount: 0,
    minApiRecords: 5,
    minSystemRecords: 5,
  });
  assert.equal(r.status, "unavailable");
  assert.equal(r.value, null);
  assert.ok(r.warnings.some((w) => /System group/i.test(w)));
});

test("normalize mode yields partial", () => {
  const r = blendNumericKpi(10, null, {
    ...base,
    fallbackMode: "normalize_effective_weights",
  }, {
    apiRecordCount: 10,
    systemRecordCount: 0,
    minApiRecords: 5,
    minSystemRecords: 5,
  });
  assert.equal(r.status, "partial");
  assert.equal(r.value, 10);
  assert.equal(r.apiEffectiveWeight, 1);
});

test("counts are not weighted", () => {
  const c = combineCounts(100, 40, 120);
  assert.equal(c.combinedDeduped, 120);
  assert.equal(c.api, 100);
});

test("confidence is not the 60/40 weights", () => {
  const c = computeBlendConfidence({
    apiRecordCount: 8,
    systemRecordCount: 5,
    minApiRecords: 8,
    minSystemRecords: 5,
    status: "complete",
  });
  assert.ok(c > 0.5 && c <= 1);
  const unavailable = computeBlendConfidence({
    apiRecordCount: 0,
    systemRecordCount: 0,
    minApiRecords: 8,
    minSystemRecords: 5,
    status: "unavailable",
  });
  assert.equal(unavailable, 0);
});

test("sample-weighted mean aggregates system group without sub-weights", () => {
  const { mean, totalN } = aggregateSampleWeightedMean([
    { value: 2, n: 3 },
    { value: 4, n: 1 },
  ]);
  assert.equal(totalN, 4);
  assert.ok(mean != null && Math.abs(mean - 2.5) < 1e-9);
});

console.log("blend-math tests passed");
