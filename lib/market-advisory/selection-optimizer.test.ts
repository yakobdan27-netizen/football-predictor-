import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectDiversifiedCandidates } from "./selection-optimizer";
import type { MsamCandidate } from "./types";

function mockCandidate(
  code: string,
  group: MsamCandidate["conflictGroup"],
  score: number
): MsamCandidate {
  return {
    marketCode: code,
    marketFamily: "TOTALS",
    conflictGroup: group,
    selectionKey: "over_2.5",
    selectionLabel: "Over 2.5",
    rawProbability: 0.6,
    calibratedProbability: 0.62,
    probabilityLower: 0.55,
    probabilityUpper: 0.68,
    calibrated: true,
    coherenceOk: true,
    nEffective: 20,
    marketDefinition: {},
    eligible: true,
    ineligibilityReasonCodes: [],
    dimensions: { ops: 62, cqs: 60, ecs: 70, sss: 75, iss: 80, dis: 85 },
    msamScore: score,
    sourceCoverage: {
      targetApiWeight: 0.6,
      targetSystemWeight: 0.4,
      effectiveApiWeight: 0.58,
      effectiveSystemWeight: 0.42,
      qApi: 0.8,
      qSystem: 0.7,
      apiRecordCount: 20,
      systemRecordCount: 15,
      effectiveSampleSize: 20,
      sourceBreakdown: "blended",
      exclusionCount: 0,
      exclusionReasons: [],
    },
    diagnosticSnapshot: {},
    explanationSnapshot: {},
  };
}

describe("selection-optimizer", () => {
  it("picks at most one per conflict group in primary", () => {
    const candidates = [
      mockCandidate("TOTALS:over_2.5", "TOTAL_GOALS", 80),
      mockCandidate("TOTALS:under_2.5", "TOTAL_GOALS", 75),
      mockCandidate("BTTS:yes", "BTTS_GOALS", 70),
      mockCandidate("RESULT_1X2:home", "RESULT_MARGIN", 65),
    ];
    const { primary } = selectDiversifiedCandidates(candidates);
    const groups = primary.map((c) => c.conflictGroup);
    assert.equal(new Set(groups).size, groups.length);
    assert.ok(primary.length >= 2);
  });
});
