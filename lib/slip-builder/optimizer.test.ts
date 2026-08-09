import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignGreedy,
  assignGlobal,
  batchTotalScore,
  maxRhoInSlip,
  optimizeSlipBatch,
} from "./optimizer";
import { heuristicLookup } from "./hist-cooccurrence";
import { conflictGroupOf, type CandidateLeg, type SlipPreferences } from "./types";
import type { FamilyPool } from "./candidate-pool";

function makeLeg(
  overrides: Partial<CandidateLeg> &
    Pick<
      CandidateLeg,
      "fixtureId" | "family" | "selectionKey" | "pCalibrated" | "competition"
    >
): CandidateLeg {
  return {
    apiFixtureId: null,
    matchId: overrides.fixtureId,
    sourceBatchId: "batch",
    homeTeam: "Home",
    awayTeam: "Away",
    kickoffIso: "2026-08-12",
    kickoffMs: Date.parse("2026-08-12T15:00:00Z"),
    selectionLabel: overrides.selectionKey,
    line: null,
    comboId: null,
    pRaw: overrides.pCalibrated,
    nEffective: 80,
    ciWidth: 0.04,
    calibrated: true,
    coherenceOk: true,
    ...overrides,
  };
}

function seededPools(): FamilyPool[] {
  // Design: family A wants f1 (0.90) and f2 (0.70)
  // family B wants f1 (0.88) and f3 (0.75)
  // Greedy taking A first leaves B with f3 only for K=1 → total 0.90+0.75=1.65
  // Global assigns f2 to A and f1 to B → 0.70+0.88=1.58? Wait need global better.
  // Better seed for global > greedy:
  // RESULT: f1=0.91, f2=0.80, f3=0.79
  // TOTALS: f1=0.90, f2=0.89, f3=0.60
  // DIEH:  f2=0.88, f3=0.87, f1=0.50
  // COMBO: f3=0.86, f4=0.85, f1=0.40
  // K=1 greedy in family order:
  //   RESULT takes f1 (0.91)
  //   TOTALS takes f2 (0.89)
  //   DIEH takes f3 (0.87)
  //   COMBO takes f4 (0.85)
  //   total = 0.91+0.89+0.87+0.85 = 3.52
  // Global optimal might be:
  //   RESULT f3=0.79, TOTALS f2=0.89, DIEH — wait DIEH wants f2
  // Actually greedy is already near-optimal. Need a case where greedy steals.
  // Classic: Slip1 takes best overall fixture that Slip4 needed more.
  // RESULT: fA=0.70, fB=0.69
  // TOTALS: fA=0.95, fC=0.60
  // DIEH:  fB=0.94, fD=0.55
  // COMBO: fC=0.93, fD=0.50
  // Greedy K=1 order RESULT→TOTALS→DIEH→COMBO:
  //   RESULT takes fA 0.70
  //   TOTALS takes fC 0.60 (fA gone)
  //   DIEH takes fB 0.94
  //   COMBO takes fD 0.50
  //   total = 0.70+0.60+0.94+0.50 = 2.74
  // Global:
  //   RESULT fB 0.69, TOTALS fA 0.95, DIEH — fB gone so fD 0.55? worse
  // Better:
  //   RESULT fB=0.69, TOTALS fA=0.95, DIEH needs different...
  //   RESULT skip? families must be used.
  // Global:
  //   RESULT fB 0.69, TOTALS fA 0.95, DIEH — only fD left for DIEH if COMBO wants fC
  //   DIEH fD 0.55, COMBO fC 0.93 → total 0.69+0.95+0.55+0.93 = 3.12 > 2.74
  // Yes!

  return [
    {
      family: "RESULT_1X2",
      eligible: [
        makeLeg({
          fixtureId: "fA",
          family: "RESULT_1X2",
          selectionKey: "home",
          pCalibrated: 0.7,
          competition: "Premier League",
        }),
        makeLeg({
          fixtureId: "fB",
          family: "RESULT_1X2",
          selectionKey: "home",
          pCalibrated: 0.69,
          competition: "La Liga",
        }),
      ],
      filtered: [],
    },
    {
      family: "TOTALS",
      eligible: [
        makeLeg({
          fixtureId: "fA",
          family: "TOTALS",
          selectionKey: "over_2.5",
          pCalibrated: 0.95,
          competition: "Premier League",
        }),
        makeLeg({
          fixtureId: "fC",
          family: "TOTALS",
          selectionKey: "under_2.5",
          pCalibrated: 0.6,
          competition: "Serie A",
        }),
      ],
      filtered: [],
    },
    {
      family: "DIEH",
      eligible: [
        makeLeg({
          fixtureId: "fB",
          family: "DIEH",
          selectionKey: "yes",
          pCalibrated: 0.94,
          competition: "La Liga",
        }),
        makeLeg({
          fixtureId: "fD",
          family: "DIEH",
          selectionKey: "yes",
          pCalibrated: 0.55,
          competition: "Bundesliga",
          // Raise so global can still beat if needed; keep as designed
        }),
      ],
      filtered: [],
    },
    {
      family: "COMBO",
      eligible: [
        makeLeg({
          fixtureId: "fC",
          family: "COMBO",
          selectionKey: "1x_over_1_5",
          pCalibrated: 0.93,
          competition: "Serie A",
          comboId: "1x_over_1_5",
        }),
        makeLeg({
          fixtureId: "fD",
          family: "COMBO",
          selectionKey: "home_over_1_5",
          pCalibrated: 0.5,
          competition: "Bundesliga",
          comboId: "home_over_1_5",
        }),
      ],
      filtered: [],
    },
  ];
}

const prefs: SlipPreferences = {
  families: ["RESULT_1X2", "TOTALS", "DIEH", "COMBO"],
  legsPerSlip: 1,
  pMin: 0.5,
  competitions: [],
  windowStart: "2026-08-01",
  windowEnd: "2026-08-31",
  maxLegsPerCompetition: 6,
  excludeUncalibrated: false,
  correlationCeiling: 0.99,
  userNote: "",
};

describe("optimizer constraints", () => {
  it("no market family appears in two slips (test 1)", () => {
    const result = optimizeSlipBatch({
      prefs,
      byFamily: seededPools(),
      allFiltered: [],
      rhoLookup: heuristicLookup(),
    });
    const families = result.slips.map((s) => s.family);
    assert.equal(new Set(families).size, families.length);
  });

  it("no fixture appears twice (test 2)", () => {
    const result = optimizeSlipBatch({
      prefs,
      byFamily: seededPools(),
      allFiltered: [],
      rhoLookup: heuristicLookup(),
    });
    const fixtures = result.slips.flatMap((s) => s.legs.map((l) => l.fixtureId));
    assert.equal(new Set(fixtures).size, fixtures.length);
  });

  it("machine legs satisfy p_min (test 3)", () => {
    const result = optimizeSlipBatch({
      prefs: { ...prefs, pMin: 0.5 },
      byFamily: seededPools(),
      allFiltered: [],
      rhoLookup: heuristicLookup(),
    });
    for (const slip of result.slips) {
      for (const leg of slip.legs) {
        if (leg.selectionSource === "machine") {
          assert.ok(leg.pCalibrated >= 0.5);
        }
      }
    }
  });

  it("no two slips share a conflict group (test 10)", () => {
    const result = optimizeSlipBatch({
      prefs,
      byFamily: seededPools(),
      allFiltered: [],
      rhoLookup: heuristicLookup(),
    });
    const groups = result.slips.map((s) => conflictGroupOf(s.family));
    assert.equal(new Set(groups).size, groups.length);
  });

  it("within-slip ρ never exceeds ceiling (test 4)", () => {
    const pools = seededPools().map((p) => ({
      ...p,
      // add second leg candidates same competition different fixtures for K=2
      eligible: [
        ...p.eligible,
        ...p.eligible.map((l, i) =>
          makeLeg({
            ...l,
            fixtureId: `${l.fixtureId}_x${i}`,
            pCalibrated: l.pCalibrated - 0.01,
            competition: "Ligue 1",
          })
        ),
      ],
    }));
    const localPrefs = { ...prefs, legsPerSlip: 2, correlationCeiling: 0.35 };
    const result = optimizeSlipBatch({
      prefs: localPrefs,
      byFamily: pools,
      allFiltered: [],
      rhoLookup: heuristicLookup(),
    });
    for (const slip of result.slips) {
      assert.ok(
        maxRhoInSlip(slip, heuristicLookup()) <= localPrefs.correlationCeiling + 1e-9
      );
    }
  });

  it("global optimum beats greedy on seeded dataset (test 5)", () => {
    const input = {
      prefs,
      byFamily: seededPools(),
      allFiltered: [],
      rhoLookup: heuristicLookup(),
    };
    const greedy = assignGreedy(input);
    const global = assignGlobal(input);
    assert.ok(
      batchTotalScore(global) + 1e-9 >= batchTotalScore(greedy),
      `global ${batchTotalScore(global)} vs greedy ${batchTotalScore(greedy)}`
    );
    // Seeded case should be strictly better
    assert.ok(
      batchTotalScore(global) > batchTotalScore(greedy) + 1e-6,
      `expected strict improvement: global ${batchTotalScore(global)} greedy ${batchTotalScore(greedy)}`
    );
  });

  it("identical inputs produce identical batch (test 6)", () => {
    const input = {
      prefs,
      byFamily: seededPools(),
      allFiltered: [],
      rhoLookup: heuristicLookup(),
    };
    const a = optimizeSlipBatch(input);
    const b = optimizeSlipBatch(input);
    const key = (r: typeof a) =>
      r.slips
        .map(
          (s) =>
            s.family +
            ":" +
            s.legs.map((l) => `${l.fixtureId}|${l.selectionKey}`).join(",")
        )
        .join(";");
    assert.equal(key(a), key(b));
  });

  it("fewer than four viable families returns fewer slips (test 8)", () => {
    const pools = seededPools().slice(0, 2);
    const result = optimizeSlipBatch({
      prefs: {
        ...prefs,
        families: ["RESULT_1X2", "TOTALS", "DIEH", "COMBO"],
      },
      byFamily: pools,
      allFiltered: [],
      rhoLookup: heuristicLookup(),
    });
    assert.ok(result.slips.length < 4);
    assert.ok(result.partialReason);
    const families = result.slips.map((s) => s.family);
    assert.equal(new Set(families).size, families.length);
  });
});
