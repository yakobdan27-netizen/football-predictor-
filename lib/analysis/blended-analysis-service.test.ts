import assert from "node:assert/strict";
import {
  buildBlendedAnalysisResult,
  shouldDisplayBlended,
} from "./blended-analysis-service";
import type { BlendConfig } from "./blend-config";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

const cfg: BlendConfig = {
  apiWeight: 0.6,
  systemWeight: 0.4,
  minApiRecords: 5,
  minSystemRecords: 5,
  maxAgeDays: 0,
  fallbackMode: "legacy",
  calculationVersion: "test",
};

test("flag off → legacy unchanged, blended disabled", () => {
  const prev = process.env.ANALYSIS_BLENDED_MODE_ENABLED;
  process.env.ANALYSIS_BLENDED_MODE_ENABLED = "0";
  try {
    const legacy = { score: 1 };
    const r = buildBlendedAnalysisResult<{ score: number }, { x: number }>({
      legacy,
      metrics: [{ key: "x", api: 10, system: 0 }],
      apiSummary: {
        recordCount: 10,
        dateRange: { from: null, to: null },
        byProvenance: {},
        excludedUnknown: 0,
      },
      systemSummary: {
        recordCount: 10,
        dateRange: { from: null, to: null },
        byProvenance: {},
        excludedUnknown: 0,
      },
      config: cfg,
    });
    assert.deepEqual(r.legacy, legacy);
    assert.equal(r.blended.enabled, false);
    assert.equal(shouldDisplayBlended(r.blended), false);
  } finally {
    if (prev == null) delete process.env.ANALYSIS_BLENDED_MODE_ENABLED;
    else process.env.ANALYSIS_BLENDED_MODE_ENABLED = prev;
  }
});

test("flag on + both sides → complete displayable blend", () => {
  const prev = process.env.ANALYSIS_BLENDED_MODE_ENABLED;
  process.env.ANALYSIS_BLENDED_MODE_ENABLED = "1";
  try {
    const r = buildBlendedAnalysisResult<{ v: number }, { x: number }>({
      legacy: { v: 99 },
      metrics: [{ key: "x", api: 10, system: 0 }],
      apiSummary: {
        recordCount: 10,
        dateRange: { from: "2020-01-01", to: "2026-01-01" },
        byProvenance: { api_historical: 10 },
        excludedUnknown: 0,
      },
      systemSummary: {
        recordCount: 10,
        dateRange: { from: "2024-01-01", to: "2026-01-01" },
        byProvenance: { manual_batch: 10 },
        excludedUnknown: 0,
      },
      config: cfg,
    });
    assert.equal(r.legacy.v, 99);
    assert.equal(r.blended.enabled, true);
    assert.equal(r.blended.status, "complete");
    assert.ok(r.blended.metrics.x != null);
    assert.ok(Math.abs(r.blended.metrics.x! - 6) < 1e-9);
    assert.equal(shouldDisplayBlended(r.blended), true);
  } finally {
    if (prev == null) delete process.env.ANALYSIS_BLENDED_MODE_ENABLED;
    else process.env.ANALYSIS_BLENDED_MODE_ENABLED = prev;
  }
});

test("dedup / unknown exclusion warning", () => {
  const prev = process.env.ANALYSIS_BLENDED_MODE_ENABLED;
  process.env.ANALYSIS_BLENDED_MODE_ENABLED = "1";
  try {
    const r = buildBlendedAnalysisResult<{ v: number }, { x: number }>({
      legacy: { v: 1 },
      metrics: [{ key: "x", api: 1, system: 1 }],
      apiSummary: {
        recordCount: 10,
        dateRange: { from: null, to: null },
        byProvenance: {},
        excludedUnknown: 2,
      },
      systemSummary: {
        recordCount: 10,
        dateRange: { from: null, to: null },
        byProvenance: {},
        excludedUnknown: 0,
      },
      config: cfg,
    });
    assert.ok(
      r.blended.quality.warnings.some((w) => /Excluded 2 unknown/i.test(w))
    );
  } finally {
    if (prev == null) delete process.env.ANALYSIS_BLENDED_MODE_ENABLED;
    else process.env.ANALYSIS_BLENDED_MODE_ENABLED = prev;
  }
});

console.log("blended-analysis-service tests passed");
