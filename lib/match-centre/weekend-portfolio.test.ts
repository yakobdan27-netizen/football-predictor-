import assert from "node:assert/strict";
import { test } from "node:test";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import { bestTeamCornerOuLeg } from "@/lib/prediction-log/corners-model";
import { buildScoreMatrix } from "@/lib/predictor/score-matrix";
import {
  curateWeekendPortfolio,
  PORTFOLIO_TARGET_TOTAL,
} from "./weekend-portfolio";

function fixtureRow(
  id: number,
  league = "Premier League"
): UpcomingFixtureRow {
  return {
    apiFixtureId: id,
    kickoffIso: `2026-08-${String(17 + (id % 10)).padStart(2, "0")}T15:00:00.000Z`,
    matchDate: `2026-08-${String(17 + (id % 10)).padStart(2, "0")}`,
    status: "NS",
    home: { id: id * 10, name: `Home ${id}` },
    away: { id: id * 10 + 1, name: `Away ${id}` },
    venue: null,
    league,
    leagueId: 39,
  };
}

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
    score_matrix: buildScoreMatrix(1.5, 1.1, -0.13, 6),
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

test("curateWeekendPortfolio produces 24 unique fixtures when pool is large enough", () => {
  const fixtures = Array.from({ length: 30 }, (_, i) => fixtureRow(i + 1));
  const estimates = fixtures.map(() => mockEstimate());
  const result = curateWeekendPortfolio({
    fixtures,
    estimates,
    calibrator: null,
    batches: [],
  });

  assert.equal(result.picks.length, PORTFOLIO_TARGET_TOTAL);
  const ids = result.picks.map((p) => p.apiFixtureId);
  assert.equal(new Set(ids).size, ids.length);
});

test("HSH portfolio picks always use 2h_gt_1h", () => {
  const fixtures = Array.from({ length: 30 }, (_, i) => fixtureRow(i + 1));
  const estimates = fixtures.map(() => mockEstimate());
  const result = curateWeekendPortfolio({
    fixtures,
    estimates,
    calibrator: null,
    batches: [],
  });

  const hsh = result.picks.filter((p) => p.category === "hsh_2h");
  assert.ok(hsh.length >= 2);
  for (const pick of hsh) {
    assert.equal(pick.trace.selectionKey, "2h_gt_1h");
    assert.equal(pick.prediction, "2nd Half");
  }
});

test("Win/DC split: 2× Match Result + 1× Double Chance", () => {
  const fixtures = Array.from({ length: 30 }, (_, i) => fixtureRow(i + 1));
  const estimates = fixtures.map(() => mockEstimate());
  const result = curateWeekendPortfolio({
    fixtures,
    estimates,
    calibrator: null,
    batches: [],
  });

  const oneX2 = result.picks.filter((p) => p.category === "result_1x2");
  const dc = result.picks.filter((p) => p.category === "double_chance");
  assert.equal(oneX2.length, 2);
  assert.equal(dc.length, 1);
  assert.equal(oneX2[0]!.trace.family, "RESULT_1X2");
  assert.equal(dc[0]!.trace.family, "DOUBLE_CHANCE");
});

test("quota reduction trims exactly 3 categories to 2 picks", () => {
  const fixtures = Array.from({ length: 30 }, (_, i) => fixtureRow(i + 1));
  const estimates = fixtures.map(() => mockEstimate());
  const result = curateWeekendPortfolio({
    fixtures,
    estimates,
    calibrator: null,
    batches: [],
  });

  assert.equal(result.reducedCategories.length, 3);
  const reduced = result.categories.filter((c) => c.reduced);
  assert.equal(reduced.length, 3);
  for (const cat of reduced) {
    assert.equal(cat.quota, 2);
  }
  const full = result.categories.filter(
    (c) => !c.reduced && c.id !== "result_1x2" && c.id !== "double_chance"
  );
  assert.equal(full.length, 5);
  for (const cat of full) {
    assert.equal(cat.quota, 3);
  }
});

test("bestTeamCornerOuLeg returns highest-probability leg", () => {
  const leg = bestTeamCornerOuLeg(5.5, 4.2);
  assert.ok(leg);
  assert.ok(leg.prob > 0 && leg.prob <= 1);
  assert.match(leg.label, /^(Home|Away) (Over|Under) /);
});

test("portfolio picks include collaborative MSAM trace fields", () => {
  const fixtures = Array.from({ length: 30 }, (_, i) => fixtureRow(i + 1));
  const estimates = fixtures.map(() => mockEstimate());
  const result = curateWeekendPortfolio({
    fixtures,
    estimates,
    calibrator: null,
    batches: [],
  });

  assert.ok(result.picks.length > 0);
  for (const pick of result.picks) {
    assert.ok(pick.trace.marketCode);
    assert.ok(
      pick.trace.finalAdvisoryScore != null &&
        Number.isFinite(pick.trace.finalAdvisoryScore)
    );
    assert.ok(pick.trace.agreementStatus);
  }
});

test("bestTeamCornerOuLeg returns null for invalid lambdas", () => {
  assert.equal(bestTeamCornerOuLeg(0, 4), null);
  assert.equal(bestTeamCornerOuLeg(NaN, 4), null);
});
