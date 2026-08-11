/**
 * Proves flag-off path matches raw weightedEstimate (legacy unchanged).
 */
import assert from "node:assert/strict";
import { weightedEstimate } from "@/lib/prediction-log/prediction-weights";
import { buildBlendedAnalysisResult } from "./blended-analysis-service";
import { attachCfeBlendedEnvelope } from "./attach-cfe-blend";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

test("flag off: blended wrapper does not alter legacy object", () => {
  const prev = process.env.ANALYSIS_BLENDED_MODE_ENABLED;
  const prevPub = process.env.NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED;
  process.env.ANALYSIS_BLENDED_MODE_ENABLED = "0";
  delete process.env.NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED;
  try {
    const legacy = { score: 42 };
    const r = buildBlendedAnalysisResult<typeof legacy, { x: number }>({
      legacy,
      metrics: [{ key: "x", api: 10, system: 0 }],
      apiSummary: {
        recordCount: 20,
        dateRange: { from: null, to: null },
        byProvenance: {},
        excludedUnknown: 0,
      },
      systemSummary: {
        recordCount: 20,
        dateRange: { from: null, to: null },
        byProvenance: {},
        excludedUnknown: 0,
      },
    });
    assert.equal(r.legacy, legacy);
    assert.equal(r.blended.enabled, false);
    assert.deepEqual(r.blended.metrics, {});
  } finally {
    if (prev == null) delete process.env.ANALYSIS_BLENDED_MODE_ENABLED;
    else process.env.ANALYSIS_BLENDED_MODE_ENABLED = prev;
    if (prevPub == null) delete process.env.NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED;
    else process.env.NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED = prevPub;
  }
});

test("flag off: attachCfeBlendedEnvelope is identity", () => {
  const prev = process.env.ANALYSIS_BLENDED_MODE_ENABLED;
  const prevPub = process.env.NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED;
  process.env.ANALYSIS_BLENDED_MODE_ENABLED = "0";
  delete process.env.NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED;
  try {
    const est = {
      lambdas: {
        home: 1.2,
        away: 1.1,
        home_1h: 0.5,
        away_1h: 0.4,
        home_2h: 0.7,
        away_2h: 0.7,
        home_corners: 5,
        away_corners: 4,
      },
      provenance: {
        api_pct: 60,
        manual_pct: 40,
        ai_pct: 40,
        seasons_used: 3,
        matches_used: 40,
        ess: 20,
        sourceBreakdown: "blended",
      },
    } as CanonicalFixtureEstimate;
    const out = attachCfeBlendedEnvelope(est, []);
    assert.equal(out, est);
    assert.equal(out.analysisBlend, undefined);
  } finally {
    if (prev == null) delete process.env.ANALYSIS_BLENDED_MODE_ENABLED;
    else process.env.ANALYSIS_BLENDED_MODE_ENABLED = prev;
    if (prevPub == null) delete process.env.NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED;
    else process.env.NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED = prevPub;
  }
});

test("weightedEstimate 60/40 golden", () => {
  const r = weightedEstimate(10, 0);
  assert.ok(r);
  assert.equal(r!.source, "blended");
  assert.ok(Math.abs(r!.value - 6) < 1e-9);
});

console.log("flag-off-identity tests passed");
