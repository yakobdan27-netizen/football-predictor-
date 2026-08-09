import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  exceedsCorrelationCeiling,
  heuristicRho,
  pairwiseRhoMatrix,
  pearsonRho,
  slipBand,
} from "./correlation";
import type { CandidateLeg } from "./types";

function leg(
  partial: Partial<CandidateLeg> & Pick<CandidateLeg, "fixtureId" | "family" | "selectionKey" | "pCalibrated">
): CandidateLeg {
  return {
    apiFixtureId: null,
    matchId: partial.fixtureId,
    sourceBatchId: "b1",
    homeTeam: "A",
    awayTeam: "B",
    competition: partial.competition ?? "Premier League",
    kickoffIso: "2026-08-10",
    kickoffMs: Date.parse("2026-08-10"),
    selectionLabel: partial.selectionKey,
    line: null,
    comboId: null,
    pRaw: partial.pCalibrated,
    nEffective: 100,
    ciWidth: 0.05,
    calibrated: true,
    coherenceOk: true,
    ...partial,
  };
}

describe("correlation (test 4)", () => {
  it("pearson detects dependence", () => {
    const a = [1, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    const b = [1, 1, 0, 0, 1, 0, 0, 0, 1, 0];
    assert.ok(pearsonRho(a, b) > 0.5);
  });

  it("slip band labels upper as independence product", () => {
    const band = slipBand([0.7, 0.8, 0.9], 0.2);
    assert.ok(Math.abs(band.independenceUpper - 0.7 * 0.8 * 0.9) < 1e-12);
    assert.ok(band.bandLower <= band.bandUpper);
    assert.equal(band.bandUpper, band.independenceUpper);
  });

  it("same-fixture heuristic ρ exceeds ceiling", () => {
    const a = leg({
      fixtureId: "f1",
      family: "RESULT_1X2",
      selectionKey: "home",
      pCalibrated: 0.7,
    });
    const b = leg({
      fixtureId: "f1",
      family: "TOTALS",
      selectionKey: "over_2.5",
      pCalibrated: 0.65,
    });
    const m = pairwiseRhoMatrix([a, b], heuristicRho);
    assert.ok(exceedsCorrelationCeiling(m, 0.35));
  });
});
