import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanonicalFixtureEstimate } from "./canonical-fixture-estimate";
import {
  buildWeekendAnalysisLearnerBatches,
  buildWeekendBaseBatch,
  unionMergeBatchMatches,
  WEEKEND_ANALYSIS_SURFACES,
} from "./weekend-analysis-learner";
import type { PredictionBatch } from "./types";

function stubEstimate(over25 = 0.55): CanonicalFixtureEstimate {
  return {
    lambdas: {
      home: 1.5,
      away: 1.1,
      home_1h: 0.7,
      away_1h: 0.5,
      home_2h: 0.8,
      away_2h: 0.6,
      home_corners: 5,
      away_corners: 4,
      home_sot: 4,
      away_sot: 3,
    },
    score_matrix: [[0.1]],
    markets: {
      home: 0.45,
      draw: 0.25,
      away: 0.3,
      bttsYes: 0.52,
      bttsNo: 0.48,
      over25,
      under25: 1 - over25,
      p1h: 0.3,
      p2h: 0.45,
      pTie: 0.25,
      p2h_gt_1h: 0.45,
      cornersOver95: 0.58,
      cornersUnder95: 0.42,
      doubleChance: { oneX: 0.7, xTwo: 0.55, oneTwo: 0.75 },
      dieh: { status: "ok", diehYes: 0.62, diehNo: 0.38, nValid: 20 },
      totalGoals: {
        lines: {
          0.5: { over: 0.9, under: 0.1 },
          1.5: { over: 0.72, under: 0.28 },
          2.5: { over: over25, under: 1 - over25 },
          3.5: { over: 0.35, under: 0.65 },
          4.5: { over: 0.18, under: 0.82 },
          5.5: { over: 0.08, under: 0.92 },
        },
      },
      sot: { status: "insufficient" },
    },
    provenance: {
      api_pct: 60,
      manual_pct: 40,
      ai_pct: 40,
      seasons_used: 3,
      matches_used: 40,
      ess: 40,
      sourceBreakdown: "blended",
    },
    coverage: { ht_pct: 0.8, corners_pct: 0.7 },
    confidence_tier: "medium",
    model_params_version: "test",
    rho: -0.13,
    diagnostics: { lambda1hPlus2h: 2.6, lambdaFt: 2.6, halfSumOk: true },
  } as CanonicalFixtureEstimate;
}

test("buildWeekendAnalysisLearnerBatches stamps one pick per surface", () => {
  const baseBatch: PredictionBatch = {
    id: "WEEKEND-2026-08-28",
    date: "2026-08-28",
    league: "Mixed",
    batchName: "Weekend Picks (API)",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    matches: [
      {
        id: "m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        league: "Premier League",
        apiFixtureId: 101,
        predictions: {},
        actualResults: {},
        scored: {},
      },
    ],
  };

  const batches = buildWeekendAnalysisLearnerBatches({
    baseBatch,
    estimates: [stubEstimate()],
    weekendRows: [
      {
        apiFixtureId: 101,
        league: "Premier League",
        kickoffIso: "2026-08-28T15:00:00.000Z",
        matchLabel: "Arsenal vs Chelsea",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        marketLabel: "Total Goals",
        prediction: "Over 2.5",
        probabilityPct: 55,
        pRaw: 0.55,
        pCalibrated: 0.55,
        rank: 1,
        msamGatePassed: true,
        trace: {
          fixtureSource: "match_centre_upcoming",
          family: "TOTALS",
          selectionKey: "over_2_5",
          pRaw: 0.55,
          pCalibrated: 0.55,
          nEffective: 40,
          coherenceOk: true,
        },
      },
    ],
  });

  assert.equal(batches.length, WEEKEND_ANALYSIS_SURFACES.length);
  const corners = batches.find((b) => b.id.includes("CORNERS"))!;
  assert.equal(corners.matches[0]!.predictions.corners_ou?.prediction, "over");
  assert.equal(corners.matches[0]!.predictions.corners_ou?.line, 9.5);

  const ladder = batches.find((b) => b.id.includes("LADDER"))!;
  assert.equal(ladder.matches[0]!.predictions.more_goals_half?.prediction, "second_half");

  const dieh = batches.find((b) => b.id.includes("DIEH"))!;
  assert.equal(dieh.matches[0]!.predictions.draw_one_half?.prediction, "yes");
});

test("buildWeekendBaseBatch persists full pool with stable ids", () => {
  const baseBatch: PredictionBatch = {
    id: "UPCOMING-2026-08-30",
    date: "2026-08-30",
    league: "Mixed",
    batchName: "Upcoming",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    matches: [
      {
        id: "UPCOMING-2026-08-30-m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        league: "Premier League",
        matchDate: "2026-08-30",
        apiFixtureId: 101,
        predictions: { "1x2": { prediction: "home", confidence: 50 } },
        actualResults: {},
        scored: {},
      },
    ],
  };

  const base = buildWeekendBaseBatch(baseBatch);
  assert.equal(base.id, "WEEKEND-2026-08-30");
  assert.equal(base.batchName, "Weekend Picks Pool");
  assert.equal(base.matches[0]!.id, "WEEKEND-2026-08-30-m1");
  assert.deepEqual(base.matches[0]!.predictions, {});
});

test("unionMergeBatchMatches keeps filled fixtures missing from refresh", () => {
  const filled: PredictionBatch = {
    id: "WEEKEND-CORNERS-2026-08-30",
    date: "2026-08-30",
    league: "Mixed",
    batchName: "corners",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    matches: [
      {
        id: "old-1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        league: "Premier League",
        apiFixtureId: 101,
        predictions: { corners_ou: { prediction: "over", line: 9.5, confidence: 58 } },
        actualResults: { corners_ou: { actual: 11 } },
        scored: { corners_ou: "correct" },
        teamStats: {
          home: { goals: 2, corners: 6 },
          away: { goals: 1, corners: 5 },
        },
        resultFilled: true,
      },
      {
        id: "old-2",
        homeTeam: "Liverpool",
        awayTeam: "Everton",
        league: "Premier League",
        apiFixtureId: 102,
        predictions: { corners_ou: { prediction: "under", line: 9.5, confidence: 55 } },
        actualResults: {},
        scored: {},
      },
    ],
  };

  const built = [
    {
      id: "new-2",
      homeTeam: "Liverpool",
      awayTeam: "Everton",
      league: "Premier League",
      apiFixtureId: 102,
      predictions: { corners_ou: { prediction: "under", line: 9.5, confidence: 56 } },
      actualResults: {},
      scored: {},
    },
  ];

  const merged = unionMergeBatchMatches(filled, built);
  assert.equal(merged.length, 2);
  const kept = merged.find((m) => m.apiFixtureId === 101)!;
  assert.equal(kept.scored.corners_ou, "correct");
  assert.equal(kept.teamStats?.home?.goals, 2);
});
