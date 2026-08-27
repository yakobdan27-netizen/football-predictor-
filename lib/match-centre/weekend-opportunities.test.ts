import assert from "node:assert/strict";
import { test } from "node:test";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import {
  filterWeekendFixtures,
  rankWeekendOpportunities,
  scoreFixtureBestMarket,
  selectWeekendPickCount,
  weekendLeagueSortIndex,
  WEEKEND_DC_TOTAL_COMBO_IDS,
  weekendComboSelectionAllowed,
  weekendHandicapSelectionAllowed,
  weekendTeamGoalsSelectionAllowed,
  weekendTotalsSelectionAllowed,
  WEEKEND_MARKET_MARGIN_MIN,
  WEEKEND_SPECIALIST_FAMILIES,
} from "./weekend-opportunities";

function row(
  id: number,
  kickoffIso: string,
  status = "NS",
  league = "Premier League"
): UpcomingFixtureRow {
  return {
    apiFixtureId: id,
    kickoffIso,
    matchDate: kickoffIso.slice(0, 10),
    status,
    home: { id: 1, name: "Home FC" },
    away: { id: 2, name: "Away FC" },
    venue: null,
    league,
    leagueId: 39,
  };
}

test("filterWeekendFixtures keeps all weekdays within 7 days", () => {
  const now = new Date("2026-08-17T12:00:00.000Z"); // Monday
  const tue = row(1, "2026-08-18T15:00:00.000Z");
  const sat = row(2, "2026-08-22T15:00:00.000Z");
  const sun = row(3, "2026-08-23T15:00:00.000Z");
  const tooFar = row(4, "2026-08-30T15:00:00.000Z");

  const out = filterWeekendFixtures([tue, sat, sun, tooFar], { now });
  assert.equal(out.length, 3);
  assert.ok(out.some((f) => f.apiFixtureId === 1));
  assert.ok(out.some((f) => f.apiFixtureId === 2));
  assert.ok(out.some((f) => f.apiFixtureId === 3));
});

test("filterWeekendFixtures excludes non-NS/TBD", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  const live = row(1, "2026-08-22T15:00:00.000Z", "1H");
  const out = filterWeekendFixtures([live], { now });
  assert.equal(out.length, 0);
});

test("selectWeekendPickCount returns full pool size", () => {
  assert.deepEqual(selectWeekendPickCount(25), {
    count: 25,
    insufficientPool: false,
  });
  assert.deepEqual(selectWeekendPickCount(8), {
    count: 8,
    insufficientPool: false,
  });
});

test("weekendTotalsSelectionAllowed excludes trivial total goals lines", () => {
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "over_0_5", 0.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "over_1_5", 1.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "over_2_5", 2.5), true);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_6_5", 6.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_5_5", 5.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_4_5", 4.5), false);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_3_5", 3.5), true);
  assert.equal(weekendTotalsSelectionAllowed("TOTALS", "under_0_5", 0.5), true);
});

test("weekendHandicapSelectionAllowed filters mis-signed home lines", () => {
  assert.equal(
    weekendHandicapSelectionAllowed("HANDICAP", "home_1.5", 1.5, 1.8),
    false
  );
  assert.equal(
    weekendHandicapSelectionAllowed("HANDICAP", "home_-1.5", -1.5, 1.8),
    true
  );
  assert.equal(
    weekendHandicapSelectionAllowed("HANDICAP", "home_1.5", 1.5, -1.2),
    true
  );
  assert.equal(
    weekendHandicapSelectionAllowed("HANDICAP", "away_-1.5", -1.5, 1.8),
    true
  );
});

test("weekendTeamGoalsSelectionAllowed enforces Over 0.5 and Under 1.5", () => {
  assert.equal(
    weekendTeamGoalsSelectionAllowed("TEAM_GOALS", "home_over_0_5", 0.5),
    true
  );
  assert.equal(
    weekendTeamGoalsSelectionAllowed("TEAM_GOALS", "away_under_1_5", 1.5),
    true
  );
  assert.equal(
    weekendTeamGoalsSelectionAllowed("TEAM_GOALS", "home_under_2_5", 2.5),
    false
  );
  assert.equal(
    weekendTeamGoalsSelectionAllowed("TEAM_GOALS", "away_under_3_5", 3.5),
    false
  );
  assert.equal(
    weekendTeamGoalsSelectionAllowed("TEAM_GOALS", "home_under_4_5", 4.5),
    false
  );
  assert.equal(weekendTeamGoalsSelectionAllowed("TEAM_GOALS", "home_cs"), true);
});

test("weekendTotalsSelectionAllowed passes through non-TOTALS families", () => {
  assert.equal(weekendTotalsSelectionAllowed("BTTS", "yes", undefined), true);
  assert.equal(weekendTotalsSelectionAllowed("RESULT_1X2", "home"), true);
});

test("weekendComboSelectionAllowed restricts combo pool for Weekend Picks", () => {
  assert.equal(
    weekendComboSelectionAllowed("COMBO", "1x_over_1_5"),
    false
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
    false
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

test("scoreFixtureBestMarket returns a pick regardless of market margin", () => {
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
      totalGoals: {
        ...mockEstimate().markets.totalGoals!,
        lines: {
          0.5: { over: flat, under: flat },
          1.5: { over: flat, under: flat },
          2.5: { over: flat, under: flat },
          3.5: { over: flat, under: flat },
          4.5: { over: flat, under: flat },
          5.5: { over: flat, under: flat },
          6.5: { over: flat, under: flat },
        },
      },
      sot: {
        ...mockEstimate().markets.sot!,
        lines: {
          match: {
            3.5: { over: flat, under: flat },
            4.5: { over: flat, under: flat },
            5.5: { over: flat, under: flat },
          },
          home: {
            1.5: { over: flat, under: flat },
            2.5: { over: flat, under: flat },
            3.5: { over: flat, under: flat },
          },
          away: {
            1.5: { over: flat, under: flat },
            2.5: { over: flat, under: flat },
            3.5: { over: flat, under: flat },
          },
        },
      },
    },
  });
  const pick = scoreFixtureBestMarket(fixture, est, null);
  assert.ok(pick);
  assert.ok(typeof pick!.marketMargin === "number");
});

test("scoreFixtureBestMarket picks clear leader with MSAM gate", () => {
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
  assert.equal(pick!.msamGatePassed, true);
});

function flatMarkets(flat: number) {
  const base = mockEstimate().markets;
  return {
    ...base,
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
    totalGoals: {
      ...base.totalGoals,
      lines: Object.fromEntries(
        Object.entries(base.totalGoals.lines).map(([k, v]) => [
          k,
          { over: flat, under: flat },
        ])
      ) as typeof base.totalGoals.lines,
    },
  };
}

test("scoreFixtureBestMarket picks DIEH over TOTALS when higher prob despite MSAM fail", () => {
  const fixture = row(101, "2026-08-22T15:00:00.000Z");
  const flat = 0.51;
  const est = mockEstimate({
    coverage: { ht_pct: 10, corners_pct: 70 },
    provenance: {
      ...mockEstimate().provenance,
      ess: 0,
      matches_used: 3,
    },
    markets: {
      ...flatMarkets(flat),
      dieh: {
        ...mockEstimate().markets.dieh,
        diehYes: 0.92,
        diehNo: 0.08,
      },
    },
  });
  const pick = scoreFixtureBestMarket(fixture, est, null);
  assert.ok(pick);
  assert.equal(pick!.family, "DIEH");
  assert.equal(pick!.msamGatePassed, false);
});

test("scoreFixtureBestMarket picks CORNERS over TOTALS when higher prob despite MSAM fail", () => {
  const fixture = row(102, "2026-08-22T15:00:00.000Z");
  const flat = 0.51;
  const est = mockEstimate({
    coverage: { ht_pct: 80, corners_pct: 10 },
    provenance: {
      ...mockEstimate().provenance,
      ess: 2,
      matches_used: 2,
    },
    lambdas: {
      ...mockEstimate().lambdas,
      home_corners: 0.1,
      away_corners: 0.1,
    },
    markets: {
      ...flatMarkets(flat),
      cornersOver95: 0.88,
      cornersUnder95: 0.12,
    },
  });
  const pick = scoreFixtureBestMarket(fixture, est, null);
  assert.ok(pick);
  assert.equal(pick!.family, "CORNERS");
  assert.equal(pick!.msamGatePassed, false);
});

test("scoreFixtureBestMarket picks HSH when highest probability", () => {
  const fixture = row(103, "2026-08-22T15:00:00.000Z");
  const flat = 0.51;
  const est = mockEstimate({
    markets: {
      ...flatMarkets(flat),
      p1h: 0.88,
      p2h: 0.07,
      pTie: 0.05,
    },
  });
  const pick = scoreFixtureBestMarket(fixture, est, null);
  assert.ok(pick);
  assert.ok(pick!.pCalibrated >= 0.85);
  assert.equal(pick!.selectionKey, "1h_gt_2h");
  assert.ok(pick!.family === "HSH" || pick!.family === "HALF_GOALS");
});

test("scoreFixtureBestMarket picks WIN_ONE_HALF when highest probability", () => {
  const fixture = row(104, "2026-08-22T15:00:00.000Z");
  const flat = 0.51;
  const est = mockEstimate({
    lambdas: {
      ...mockEstimate().lambdas,
      home_1h: 2.2,
      away_1h: 0.2,
      home_2h: 2.0,
      away_2h: 0.25,
    },
    markets: flatMarkets(flat),
  });
  const pick = scoreFixtureBestMarket(fixture, est, null);
  assert.ok(pick);
  assert.equal(pick!.family, "WIN_ONE_HALF");
  assert.equal(pick!.selectionKey, "home");
});

test("WEEKEND_SPECIALIST_FAMILIES lists trusted specialist markets", () => {
  assert.deepEqual(WEEKEND_SPECIALIST_FAMILIES, [
    "DIEH",
    "CORNERS",
    "HANDICAP",
    "HSH",
    "WIN_ONE_HALF",
  ]);
});

test("weekendLeagueSortIndex follows Big-5 order", () => {
  assert.equal(weekendLeagueSortIndex("Premier League"), 0);
  assert.equal(weekendLeagueSortIndex("La Liga"), 1);
  assert.equal(weekendLeagueSortIndex("Serie A"), 2);
  assert.equal(weekendLeagueSortIndex("Bundesliga"), 3);
  assert.equal(weekendLeagueSortIndex("Ligue 1"), 4);
  assert.equal(weekendLeagueSortIndex("Unknown"), 5);
});

test("rankWeekendOpportunities ranks globally by probability", () => {
  const fixtures = [
    row(1, "2026-08-22T15:00:00.000Z", "NS", "Ligue 1"),
    row(2, "2026-08-22T15:00:00.000Z", "NS", "Premier League"),
    row(3, "2026-08-22T15:00:00.000Z", "NS", "Serie A"),
  ];
  const high = mockEstimate({
    markets: {
      ...mockEstimate().markets,
      dieh: { ...mockEstimate().markets.dieh, diehYes: 0.95, diehNo: 0.05 },
    },
  });
  const mid = mockEstimate({
    markets: {
      ...mockEstimate().markets,
      dieh: { ...mockEstimate().markets.dieh, diehYes: 0.75, diehNo: 0.25 },
    },
  });
  const low = mockEstimate({
    markets: {
      ...mockEstimate().markets,
      dieh: { ...mockEstimate().markets.dieh, diehYes: 0.55, diehNo: 0.45 },
    },
  });
  const result = rankWeekendOpportunities({
    fixtures,
    estimates: [high, low, mid],
    calibrator: null,
  });
  const probs = result.rows.map((r) => r.pCalibrated ?? -1);
  assert.ok(probs[0]! >= probs[1]! && probs[1]! >= probs[2]!);
  assert.notEqual(result.rows[0]!.league, result.rows[1]!.league);
});

test("rankWeekendOpportunities returns one row per fixture", () => {
  const fixtures = Array.from({ length: 15 }, (_, i) =>
    row(200 + i, "2026-08-22T15:00:00.000Z")
  );
  const flatEst = mockEstimate({
    markets: {
      ...mockEstimate().markets,
      home: 0.51,
      draw: 0.51,
      away: 0.51,
      bttsYes: 0.51,
      bttsNo: 0.51,
      over25: 0.51,
      under25: 0.51,
      p1h: 0.51,
      p2h: 0.51,
      pTie: 0.51,
      p2h_gt_1h: 0.51,
      cornersOver95: 0.51,
      cornersUnder95: 0.51,
      doubleChance: { oneX: 0.51, xTwo: 0.51, oneTwo: 0.51 },
      dieh: {
        ...mockEstimate().markets.dieh,
        diehYes: 0.51,
        diehNo: 0.51,
      },
    },
  });
  const clearEst = mockEstimate({
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
  const estimates = fixtures.map((_, i) =>
    i === 0 ? clearEst : flatEst
  );
  const result = rankWeekendOpportunities({
    fixtures,
    estimates,
    calibrator: null,
  });
  assert.equal(result.selectedCount, 15);
  assert.equal(result.rows.length, 15);
  assert.equal(result.rows[0]!.trace.marginOk, true);
  assert.ok(result.rows[0]!.pCalibrated >= result.rows[1]!.pCalibrated);
});

test("rankWeekendOpportunities includes fixture without estimate", () => {
  const fixtures = [row(1, "2026-08-22T15:00:00.000Z"), row(2, "2026-08-23T15:00:00.000Z")];
  const result = rankWeekendOpportunities({
    fixtures,
    estimates: [mockEstimate()],
    calibrator: null,
  });
  assert.equal(result.rows.length, 2);
  const empty = result.rows.find((r) => r.apiFixtureId === 2);
  assert.ok(empty);
  assert.equal(empty!.probabilityPct, null);
  assert.equal(empty!.trace.noEstimate, true);
});
