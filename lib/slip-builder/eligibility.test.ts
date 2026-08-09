import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gateLeg } from "./eligibility";
import type { CandidateLeg, SlipPreferences } from "./types";

function baseLeg(over: Partial<CandidateLeg> = {}): CandidateLeg {
  return {
    fixtureId: "f1",
    apiFixtureId: 1,
    matchId: "m1",
    sourceBatchId: "b",
    homeTeam: "A",
    awayTeam: "B",
    competition: "Premier League",
    kickoffIso: "2026-08-10",
    kickoffMs: Date.parse("2026-08-10"),
    family: "RESULT_1X2",
    selectionKey: "home",
    selectionLabel: "Home Win",
    line: null,
    comboId: null,
    pRaw: 0.7,
    pCalibrated: 0.7,
    nEffective: 100,
    ciWidth: 0.05,
    calibrated: true,
    coherenceOk: true,
    ...over,
  };
}

const prefs: SlipPreferences = {
  families: ["RESULT_1X2", "TOTALS", "DIEH", "COMBO"],
  legsPerSlip: 3,
  pMin: 0.6,
  competitions: [],
  windowStart: "2026-08-01",
  windowEnd: "2026-08-31",
  maxLegsPerCompetition: 2,
  excludeUncalibrated: true,
  correlationCeiling: 0.35,
  userNote: "",
};

describe("eligibility gates (test 3)", () => {
  it("excludes below p_min", () => {
    const reasons = gateLeg(
      baseLeg({ pCalibrated: 0.55 }),
      prefs,
      { start: "2026-08-01", end: "2026-08-31" }
    );
    assert.ok(reasons.includes("probability_floor"));
  });

  it("excludes thin samples", () => {
    const reasons = gateLeg(
      baseLeg({ nEffective: 10 }),
      prefs,
      { start: "2026-08-01", end: "2026-08-31" }
    );
    assert.ok(reasons.includes("sample_insufficiency"));
  });

  it("excludes uncalibrated when toggle on", () => {
    const reasons = gateLeg(
      baseLeg({ calibrated: false }),
      prefs,
      { start: "2026-08-01", end: "2026-08-31" }
    );
    assert.ok(reasons.includes("uncalibrated"));
  });

  it("passes a healthy leg", () => {
    const reasons = gateLeg(baseLeg(), prefs, {
      start: "2026-08-01",
      end: "2026-08-31",
    });
    assert.deepEqual(reasons, []);
  });
});
