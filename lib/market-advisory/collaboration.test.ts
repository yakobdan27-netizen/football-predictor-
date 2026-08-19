import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyCollaboration } from "./collaboration";
import type { EmsSnapshot, MsamCandidate } from "./types";

function baseCandidate(code: string, msam: number): MsamCandidate {
  return {
    marketCode: code,
    marketFamily: "TOTALS",
    conflictGroup: "TOTAL_GOALS",
    selectionKey: "over_2.5",
    selectionLabel: "Over 2.5",
    rawProbability: 0.65,
    calibratedProbability: 0.65,
    probabilityLower: null,
    probabilityUpper: null,
    calibrated: true,
    coherenceOk: true,
    nEffective: 20,
    marketDefinition: {},
    eligible: true,
    ineligibilityReasonCodes: [],
    dimensions: { ops: 65, cqs: 60, ecs: 70, sss: 72, iss: 80, dis: 85 },
    msamScore: msam,
    sourceCoverage: {
      targetApiWeight: 0.6,
      targetSystemWeight: 0.4,
      effectiveApiWeight: 0.6,
      effectiveSystemWeight: 0.4,
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

describe("collaboration", () => {
  it("assigns Strong Agreement when EMS and MSAM both rank top", () => {
    const candidates = [
      baseCandidate("TOTALS:over_2.5", 80),
      baseCandidate("BTTS:yes", 60),
    ];
    candidates[1]!.marketCode = "BTTS:yes";
    candidates[1]!.conflictGroup = "BTTS_GOALS";

    const ems: EmsSnapshot = {
      kind: "decision_maker",
      snapshotVersion: "test",
      candidates: [
        {
          marketCode: "TOTALS:over_2.5",
          marketLabel: "Total Goals",
          prediction: "Over 2.5",
          emsScore: 90,
          emsConfidence: 85,
          existingRank: 1,
        },
      ],
    };

    const { scored } = applyCollaboration({
      candidates,
      emsSnapshot: ems,
      primary: [candidates[0]!],
    });

    const top = scored.find((c) => c.marketCode === "TOTALS:over_2.5");
    assert.equal(top?.agreementStatus, "Strong Agreement");
    assert.ok((top?.finalAdvisoryScore ?? 0) > 0);
  });
});
