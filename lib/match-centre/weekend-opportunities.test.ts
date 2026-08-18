import assert from "node:assert/strict";
import { test } from "node:test";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import {
  filterWeekendFixtures,
  scoreFixtureBestMarket,
  selectWeekendPickCount,
  WEEKEND_DC_TOTAL_COMBO_IDS,
  weekendComboSelectionAllowed,
  weekendTotalsSelectionAllowed,
  WEEKEND_MARKET_MARGIN_MIN,
  WEEKEND_PICK_MAX,
  WEEKEND_PICK_MIN,
} from "./weekend-opportunities";

function row(
  id: number,
  kickoffIso: string,
  status = "NS"
): UpcomingFixtureRow {
  return {
    apiFixtureId: id,
    kickoffIso,
    matchDate: kickoffIso.slice(0, 10),
    status,
    home: { id: 1, name: "Home FC" },
    away: { id: 2, name: "Away FC" },
    venue: null,
    league: "Premier League",
    leagueId: 39,
  };
}

test("filterWeekendFixtures keeps Sat/Sun within 7 days", () => {
  const now = new Date("2026-08-17T12:00:00.000Z"); // Monday
  const sat = row(1, "2026-08-22T15:00:00.000Z");
  const sun = row(2, "2026-08-23T15:00:00.000Z");
  const mon = row(3, "2026-08-24T15:00:00.000Z");
  const tooFar = row(4, "2026-08-30T15:00:00.000Z");

  const out = filterWeekendFixtures([sat, sun, mon, tooFar], { now });
  assert.equal(out.length, 2);
  assert.ok(out.some((f) => f.apiFixtureId === 1));
  assert.ok(out.some((f) => f.apiFixtureId === 2));
});

test("filterWeekendFixtures excludes non-NS/TBD", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  const live = row(1, "2026-08-22T15:00:00.000Z", "1H");
  const out = filterWeekendFixtures([live], { now });
  assert.equal(out.length, 0);
});

test("selectWeekendPickCount caps at 20 and floors at 10 when pool large enough", () => {
  assert.deepEqual(selectWeekendPickCount(25), {
    count: WEEKEND_PICK_MAX,
    insufficientPool: false,
  });
  assert.deepEqual(selectWeekendPickCount(15), {
    count: 15,
    insufficientPool: false,
  });
  assert.deepEqual(selectWeekendPickCount(10), {
    count: WEEKEND_PICK_MIN,
    insufficientPool: false,
  });
});

test("selectWeekendPickCount returns all when pool below minimum", () => {
  assert.deepEqual(selectWeekendPickCount(8), {
    count: 8,
    insufficientPool: true,
  });
  assert.deepEqual(selectWeekendPickCount(0), {
    count: 0,
    insufficientPool: false,
  });
});

test("weekendTotalsSelectionAllowed excludes trivial total goals lines", () => {
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "over_0_5", 0.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "over_1_5", 1.5), true);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "over_2_5", 2.5), true);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_6_5", 6.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_5_5", 5.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_4_5", 4.5), true);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_0_5", 0.5), true);
});

test("weekendTotalsSelectionAllowed passes through non-TOTALS families", () => {
  assert.equal(weekendTotalsSelectionAllowed("BTTS", "yes", undefined), true);
  assert.equal(weekendTotalsSelectionAllowed("RESULT_1X2", "home"), true);
});

test("weekendComboSelectionAllowed restricts combo pool for Weekend Picks", () => {
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "1x_over_1_5"),
    true
  );
  for (const id of WEEKEND_DC_TOTAL_COMBO_IDS) {
    assert.equal(weekendComboSelectionAllowed("COMBO", id), true, id);
  }
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "1x_under_3_5"),
    false
  );
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "x2_under_3_5"),
    false
  );
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "1x_btts_yes"),
    true
  );
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "btts_yes_over_2_5"),
    true
  );
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "home_over_1_5"),
    true
  );
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "home_btts_yes"),
    false
  );
  assert.equal(weekendComboSelectionAllowed("BTTS", "yes"), true);
});

function mockEstimate(
  overrides?: Partial<CanonicalFixtureEstimate>
): CanonicalFixtureEstimate {
  const base = {
    lambdas: {
      home: 1.5,
      away: 1.1,
      home_1h: 0.7,
      away_1h: 0.5,
      home_2h: 0.8,
      away_2h: 0.6,
      home_corners: 5,
      away_corners: 4.5,
      home_sot: 2.5,
      away_sot: 2.1,
    },
    score_matrix: [[0.2, 0.15], [0.12, 0.1]],
    markets: {
      home: 0.45,
      draw: 0.28,
      away: 0.27,
      bttsYes: 0.55,
      bttsNo: 0.45,
      over25: 0.52,
      under25: 0.48,
      p1h: 0.38,
      p2h: 0.42,
      pTie: 0.2,
      p2h_gt_1h: 0.42,
      cornersOver95: 0.51,
      cornersUnder95: 0.49,
      doubleChance: { oneX: 0.73, xTwo: 0.55, oneTwo: 0.72 },
      dieh: {
        status: "ok" as const,
        nValid: 500,
        pD1: 0.3,
        pD2: 0.32,
        pD1AndD2: 0.1,
        diehYes: 0.62,
        diehNo: 0.38,
        halfLambdas: null,
        halfShares: null,
        kappaAdj: null,
        kappaRaw: null,
      },
      totalGoals: {
        distributionFamily: "poisson" as const,
        dispersion: null,
        pmf: [0.1, 0.2, 0.3, 0.2, 0.1, 0.05, 0.03, 0.02, 0],
        expectedTotal: 2.6,
        mode: 2,
        ci50: [2, 3] as [number, number],
        lines: {
          0.5: { over: 0.9, under: 0.1 },
          1.5: { over: 0.7, under: 0.3 },
          2.5: { over: 0.52, under: 0.48 },
          3.5: { over: 0.35, under: 0.65 },
          4.5: { over: 0.2, under: 0.8 },
          5.5: { over: 0.1, under: 0.9 },
          6.5: { over: 0.05, under: 0.95 },
        },
      },
      sot: {
        status: "ok" as const,
        lambdaHome: 2.5,
        lambdaAway: 2.1,
        nMatches: 10,
        confidence: "medium" as const,
        lines: {
          match: {
            3.5: { over: 0.6, under: 0.4 },
            4.5: { over: 0.58, under: 0.42 },
            5.5: { over: 0.4, under: 0.6 },
          },
          home: {
            1.5: { over: 0.6, under: 0.4 },
            2.5: { over: 0.55, under: 0.45 },
            3.5: { over: 0.35, under: 0.65 },
          },
          away: {
            1.5: { over: 0.55, under: 0.45 },
            2.5: { over: 0.48, under: 0.52 },
            3.5: { over: 0.3, under: 0.7 },
          },
        },
      },
    },
    provenance: {
      api_pct: 100,
      manual_pct: 0,
      ai_pct: 0,
      seasons_used: 2,
      matches_used: 20,
      ess: 15,
      sourceBreakdown: "api_only" as const,
    },
    coverage: { ht_pct: 80, corners_pct: 70 },
    confidence_tier: "medium" as const,
    model_params_version: "test",
    rho: -0.13,
    diagnostics: {
      lambda1hPlus2h: 2.6,
      lambdaFt: 2.6,
      halfSumOk: true,
    },
  } satisfies CanonicalFixtureEstimate;
  return { ...base, ...overrides };
}

test("scoreFixtureBestMarket rejects when margin below threshold", () => {
  const fixture = row(99, "2026-08-22T15:00:00.000Z");
  const flat = 0.51;
  const est = mockEstimate({
    markets: {
      ...mockEstimate().markets,
      home: flat,
      draw: flat,
      away: flat,
      bttsYes: flat,
      bttsNo: flat,
      over25: flat,
      under25: flat,
      p1h: flat,
      p2h: flat,
      pTie: flat,
      p2h_gt_1h: flat,
      cornersOver95: flat,
      cornersUnder95: flat,
      doubleChance: { oneX: flat, xTwo: flat, oneTwo: flat },
      dieh: {
        ...mockEstimate().markets.dieh,
        diehYes: flat,
        diehNo: flat,
      },
    },
  });
  const pick = scoreFixtureBestMarket(fixture, est, null);
  assert.equal(pick, null);
});

test("scoreFixtureBestMarket accepts clear leader above margin", () => {
  const fixture = row(100, "2026-08-22T15:00:00.000Z");
  const est = mockEstimate({
    markets: {
      ...mockEstimate().markets,
      dieh: {
        ...mockEstimate().markets.dieh,
        diehYes: 0.92,
        diehNo: 0.08,
      },
      doubleChance: { oneX: 0.72, xTwo: 0.55, oneTwo: 0.72 },
    },
  });
  const pick = scoreFixtureBestMarket(fixture, est, null);
  assert.ok(pick);
  assert.equal(pick!.family, "DIEH");
  assert.ok((pick!.marketMargin ?? 0) >= WEEKEND_MARKET_MARGIN_MIN);
});
