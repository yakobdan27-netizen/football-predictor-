import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildScoreMatrix } from "@/lib/predictor/score-matrix";
import { runIntegrityGate } from "./integrity-gate";
import { computeEffectiveWeights, computeSourceQuality } from "./source-coverage";
import { minimalCfe } from "./test-fixtures";

describe("integrity-gate", () => {
  it("passes coherent CFE grid", () => {
    const gate = runIntegrityGate(minimalCfe());
    assert.equal(gate.passed, true);
    assert.equal(gate.checks.every((c) => c.ok), true);
  });

  it("fails when grid sum != 1", () => {
    const cfe = minimalCfe();
    cfe.score_matrix = buildScoreMatrix(1.4, 1.1, -0.13, 9).map((row) =>
      row.map((p) => p * 1.01)
    );
    const gate = runIntegrityGate(cfe);
    assert.equal(gate.passed, false);
    assert.ok(gate.suppressedFamilies.has("ALL"));
  });
});

describe("source-coverage", () => {
  it("computes effective weights from provenance", () => {
    const cfe = minimalCfe();
    const { qApi, qSystem } = computeSourceQuality(cfe);
    assert.ok(qApi > 0 && qSystem > 0);
    const { wApi, wSystem } = computeEffectiveWeights(qApi, qSystem);
    assert.ok(Math.abs(wApi + wSystem - 1) < 1e-6);
  });
});
