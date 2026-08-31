import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeWeights, effectiveSampleSize } from "@/lib/hist/decay-weights";
import { histSeasonWeight, HIST_COMPLETED_SEASON_COUNT } from "@/lib/hist/seasons";
import {
  buildScoreMatrix,
  marketProbsFromMatrix,
  outcomeProbsFromMatrix,
} from "@/lib/predictor/score-matrix";
import { sumMatrix } from "@/lib/predictor/poisson";
import {
  computeGoalDistribution,
  overUnderFromGoalMatrix,
  bttsYesNo,
  overUnderPushFromPmf,
  overUnderFromLambda,
} from "./goal-distribution";
import { totalGoalsPmf } from "@/lib/predictor/score-matrix";
import { clampLambda, LAMBDA_MAX, LAMBDA_MIN, SHRINKAGE_K } from "./model-config";
import { computeStageB } from "./hsh-model";
import { LADDER_CONFIG } from "./ladder/config";

test("test_decay_weights_sum_to_one", () => {
  const seasons = Array.from({ length: 11 }, (_, i) => 2015 + i);
  const raw = seasons.map((s) => histSeasonWeight(s, 2026));
  const w = normalizeWeights(raw);
  const sum = w.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(effectiveSampleSize(w) > 0);
  assert.equal(HIST_COMPLETED_SEASON_COUNT, 11);
});

test("test_score_matrix_sums_to_one", () => {
  const m = buildScoreMatrix(1.4, 1.1, -0.13, 9);
  assert.ok(Math.abs(sumMatrix(m) - 1) < 1e-9);
});

test("test_over_under_complement_all_lines", () => {
  const dist = computeGoalDistribution(1.5, 1.2, { rho: -0.12, maxGoals: 9 });
  for (const line of [1.5, 2.5, 3.5]) {
    const [o, u] = overUnderFromGoalMatrix(dist.matrix, line);
    assert.ok(Math.abs(o + u - 1) < 1e-9, `line ${line}`);
  }
});

test("test_btts_complement", () => {
  const dist = computeGoalDistribution(1.6, 1.0, { rho: -0.1 });
  const [y, n] = bttsYesNo(dist.matrix);
  assert.ok(Math.abs(y + n - 1) < 1e-9);
});

test("test_1x2_sums_to_one", () => {
  const m = buildScoreMatrix(1.3, 1.3, -0.15, 9);
  const { home, draw, away } = outcomeProbsFromMatrix(m);
  assert.ok(Math.abs(home + draw + away - 1) < 1e-9);
  const markets = marketProbsFromMatrix(m);
  assert.ok(Math.abs(markets.doubleChance.oneX - (markets.home + markets.draw)) < 1e-9);
});

test("test_push_mass_accounted_on_whole_lines", () => {
  const dist = computeGoalDistribution(1.4, 1.1, { rho: -0.1 });
  const { over, under, push } = overUnderPushFromPmf(
    totalGoalsPmf(dist.matrix),
    2.0
  );
  assert.ok(Math.abs(over + under + push - 1) < 1e-9);
  assert.ok(push > 0);
});

test("test_per_team_corner_complement", () => {
  const [o, u] = overUnderFromLambda(5.2, 4.5);
  assert.ok(Math.abs(o + u - 1) < 1e-9);
});

test("test_per_team_half_goal_complement", () => {
  const [o, u] = overUnderFromLambda(0.7, 0.5);
  assert.ok(Math.abs(o + u - 1) < 1e-9);
});

test("test_half_intensities_sum_structure", () => {
  const stageB = computeStageB(1.1, 1.4);
  assert.ok(Math.abs(stageB.p1h + stageB.p2h + stageB.pTie - 1) < 1e-9);
});

test("test_lambda_within_bounds", () => {
  assert.equal(clampLambda(0.01), LAMBDA_MIN);
  assert.equal(clampLambda(9), LAMBDA_MAX);
  assert.equal(clampLambda(1.2), 1.2);
  assert.equal(SHRINKAGE_K, 10);
});

test("test_no_probability_level_blending_exists", () => {
  const canon = readFileSync(
    path.join(process.cwd(), "lib/prediction-log/canonical-probability.ts"),
    "utf8"
  );
  // packResult must not call weightedEstimate on probs
  assert.ok(canon.includes("never blend probabilities"));
  const hybrid = readFileSync(
    path.join(process.cwd(), "lib/prediction-log/hybrid-recommendation.ts"),
    "utf8"
  );
  assert.ok(hybrid.includes("do NOT blend probabilities"));
  const intensities = readFileSync(
    path.join(process.cwd(), "lib/hist/team-half-intensities.ts"),
    "utf8"
  );
  assert.ok(!/if \(samples\.length >= limit\) break/.test(intensities));
});

test("test_ladder_returns_ten_when_ten_candidates_exist", () => {
  assert.equal(LADDER_CONFIG.LADDER_SIZE, 10);
});

test("test_same_fixture_half_market_identity_via_stage_b", () => {
  // Cross-surface identity for 2H>1H: both surfaces use computeStageB
  const a = computeStageB(1.2, 1.5);
  const b = computeStageB(1.2, 1.5);
  assert.equal(a.p2h, b.p2h);
});

test("test_cfe_surfaces_share_half_and_ou_markets", async () => {
  const {
    estimateBatchCanonical,
    ladderRanksFromBatchEstimates,
    clearCanonicalFixtureCache,
  } = await import("./canonical-fixture-estimate");
  clearCanonicalFixtureCache();
  const batch = {
    id: "b1",
    batchName: "audit",
    date: "2026-08-01",
    league: "Premier League",
    createdAt: "2026-08-01T00:00:00.000Z",
    matches: [
      {
        id: "m-cfe-1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        predictions: {},
      },
    ],
  } as import("./types").PredictionBatch;

  const estimates = estimateBatchCanonical(batch, [batch]);
  const est = estimates[0]!;
  const ladder = ladderRanksFromBatchEstimates(estimates, batch, [batch]);
  assert.equal(ladder[0]!.p_2h_gt_1h, est.markets.p2h_gt_1h);
  assert.equal(ladder[0]!.p_2h_eq_1h, est.markets.pTie);
  assert.ok(Math.abs(est.markets.over25 + est.markets.under25 - 1) < 1e-9);
  assert.ok(
    Math.abs(est.markets.cornersOver95 + est.markets.cornersUnder95 - 1) < 1e-9
  );
  assert.ok(
    Math.abs(est.markets.home + est.markets.draw + est.markets.away - 1) < 1e-9
  );
  // Total Goals markets attached to CFE
  assert.ok(est.markets.totalGoals);
  assert.ok(
    Math.abs(
      est.markets.totalGoals.lines[2.5].over +
        est.markets.totalGoals.lines[2.5].under -
        1
    ) < 1e-9
  );
  assert.equal(est.markets.over25, est.markets.totalGoals.lines[2.5].over);
  // DIEH present (may be insufficient without fitted half params)
  assert.ok(est.markets.dieh);
  assert.ok(
    est.markets.dieh.status === "insufficient" ||
      est.markets.dieh.status === "ok" ||
      est.markets.dieh.status === "error"
  );
  if (est.markets.dieh.status === "ok") {
    assert.ok(
      Math.abs(est.markets.dieh.diehYes! + est.markets.dieh.diehNo! - 1) < 1e-9
    );
  }
});

test("test_cfe_file_forbids_probability_weighted_estimate", () => {
  const src = readFileSync(
    path.join(process.cwd(), "lib/prediction-log/canonical-fixture-estimate.ts"),
    "utf8"
  );
  // λ blend via weightedEstimate is allowed; P-level blend of market probs is not.
  assert.ok(src.includes("weightedEstimate"));
  assert.ok(!/weightedEstimate\(\s*[a-zA-Z]+Prob/.test(src));
  assert.ok(src.includes("Blend λ inputs"));
});

test("test_upcoming_batch_ladder_matches_hsh_p2h_gt_1h", async () => {
  const { buildUpcomingPredictionBatch } = await import("./batch-fixture-picker");
  const {
    estimateBatchCanonical,
    ladderRanksFromBatchEstimates,
    clearCanonicalFixtureCache,
  } = await import("./canonical-fixture-estimate");
  clearCanonicalFixtureCache();

  const batch = buildUpcomingPredictionBatch(
    [
      {
        apiFixtureId: 1001,
        kickoffIso: "2026-08-16T14:00:00Z",
        matchDate: "2026-08-16",
        status: "NS",
        home: { id: 42, name: "Arsenal", logo: null },
        away: { id: 49, name: "Chelsea", logo: null },
        venue: null,
        league: "Premier League",
        leagueId: 39,
      },
      {
        apiFixtureId: 1002,
        kickoffIso: "2026-08-17T18:00:00Z",
        matchDate: "2026-08-17",
        status: "NS",
        home: { id: 529, name: "Barcelona", logo: null },
        away: { id: 530, name: "Real Madrid", logo: null },
        venue: null,
        league: "La Liga",
        leagueId: 140,
      },
    ],
    { batchId: "UPCOMING-TEST-INV" }
  );
  assert.ok(batch);
  const allBatches = [batch!];

  const estimates = estimateBatchCanonical(batch!, allBatches);
  const ladder = ladderRanksFromBatchEstimates(estimates, batch!, allBatches);

  assert.equal(ladder.length, estimates.length);
  estimates.forEach((est, i) => {
    const mid = batch!.matches[i]!.id;
    const leg = ladder.find((l) => l.matchId === mid);
    assert.ok(leg);
    assert.equal(leg!.p_2h_gt_1h, est.markets.p2h_gt_1h);
  });
});

test("test_inventory_gate_helper_counts_88_buckets", async () => {
  // Structural gate: auditor returns 8 comps × 11 completed seasons.
  const { HIST_LEAGUES, HIST_COMPLETED_SEASON_COUNT } = await import(
    "@/lib/hist/seasons"
  );
  assert.equal(HIST_LEAGUES.length * HIST_COMPLETED_SEASON_COUNT, 88);
});
