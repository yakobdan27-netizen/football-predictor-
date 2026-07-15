import assert from "node:assert/strict";
import {
  computeLeagueHalfShare,
  computeStageA,
  computeStageB,
  computeTeamHalfShare,
  confidenceBand,
  estimateRestDays,
  predictHighestScoringHalf,
  recommendedHalf,
  topProbability,
  type HshLeagueHalfShare,
  type HshTeamHalfShare,
} from "./hsh-model";
import type { PredictionBatch } from "./types";

function makeMatch(
  homeTeam: string,
  awayTeam: string,
  homeHt: number,
  homeFt: number,
  awayHt: number,
  awayFt: number
) {
  return {
    id: `${homeTeam}-${awayTeam}-${Math.random()}`,
    homeTeam,
    awayTeam,
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: homeFt, firstHalfGoals: homeHt },
      away: { goals: awayFt, firstHalfGoals: awayHt },
    },
  };
}

function makeBatch(date: string, league: string, matches: ReturnType<typeof makeMatch>[]): PredictionBatch {
  return {
    id: `batch-${date}-${Math.random()}`,
    date,
    league,
    batchName: "test batch",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    matches,
  };
}

// --- Section 7 worked example -------------------------------------------
// xg_home=1.8, xg_away=1.0; home 1H share .42/.58; away .40/.60;
// league .45/.55; w_team=.65 -> lambda_1h ~= 1.19, lambda_2h ~= 1.61,
// and P(2H more) should be the largest probability.
{
  const homeHalfShare: HshTeamHalfShare = {
    sample: 15,
    gf1h: 0.42,
    gf2h: 0.58,
    ga1h: 0,
    ga2h: 0,
    share1h: 0.42,
    share2h: 0.58,
    p1hMore: 0,
    p2hMore: 0,
    pTie: 0,
  };
  const awayHalfShare: HshTeamHalfShare = {
    ...homeHalfShare,
    share1h: 0.4,
    share2h: 0.6,
  };
  const leagueHalfShare: HshLeagueHalfShare = {
    sample: 200,
    league1hShare: 0.45,
    league2hShare: 0.55,
    leagueAvgGoals: 2.7,
  };

  const stageA = computeStageA({
    xgHome: 1.8,
    xgAway: 1.0,
    homeHalfShare,
    awayHalfShare,
    leagueHalfShare,
    wTeam: 0.65,
  });

  assert.ok(Math.abs(stageA.lambda1h - 1.19) < 0.02, `lambda1h ~1.19, got ${stageA.lambda1h}`);
  assert.ok(Math.abs(stageA.lambda2h - 1.61) < 0.02, `lambda2h ~1.61, got ${stageA.lambda2h}`);

  const stageB = computeStageB(stageA.lambda1h, stageA.lambda2h);
  assert.ok(
    stageB.p2h > stageB.p1h && stageB.p2h > stageB.pTie,
    "2H should be the most likely outcome in the worked example"
  );
  assert.equal(recommendedHalf(stageB), "2H");

  const sumProbs = stageB.p1h + stageB.p2h + stageB.pTie;
  assert.ok(Math.abs(sumProbs - 1) < 1e-9, "probabilities must sum to 1");
}

// --- Stage B sanity: symmetric lambdas favour a tie more than skewed ones
{
  const symmetric = computeStageB(1.2, 1.2);
  const skewed = computeStageB(0.3, 2.5);
  assert.ok(symmetric.pTie > skewed.pTie, "closer lambdas should yield a higher tie probability");
}

// --- Confidence banding ---------------------------------------------------
assert.equal(confidenceBand(0.55, 15, 14), "high");
assert.equal(confidenceBand(0.55, 15, 4), "low", "either team below 6 samples forces low");
assert.equal(confidenceBand(0.45, 20, 20), "medium", "prob in medium band even with big samples");
assert.equal(confidenceBand(0.6, 8, 9), "medium", "sample count 6-11 caps confidence at medium");
assert.equal(confidenceBand(0.35, 30, 30), "low", "low top probability is always low confidence");

// --- Team half share from synthetic batches -------------------------------
{
  const batches: PredictionBatch[] = [
    makeBatch("2025-08-01", "Premier League", [makeMatch("Arsenal", "Chelsea", 1, 2, 0, 1)]),
    makeBatch("2025-08-15", "Premier League", [makeMatch("Arsenal", "Fulham", 0, 1, 0, 0)]),
    makeBatch("2025-09-01", "Premier League", [makeMatch("Everton", "Arsenal", 0, 0, 2, 3)]),
  ];

  const homeShare = computeTeamHalfShare(batches, "Arsenal", "home");
  assert.equal(homeShare.sample, 2, "two Arsenal home matches with full HT data");
  assert.ok(homeShare.share1h > 0 && homeShare.share1h < 1);

  const leagueShare = computeLeagueHalfShare(batches, "Premier League");
  assert.equal(leagueShare.sample, 3);
}

// --- Rest days -------------------------------------------------------------
{
  const batches: PredictionBatch[] = [
    makeBatch("2025-08-01", "Premier League", [makeMatch("Arsenal", "Chelsea", 1, 2, 0, 1)]),
    makeBatch("2025-08-05", "Premier League", [makeMatch("Wolves", "Arsenal", 0, 0, 0, 0)]),
  ];
  const rest = estimateRestDays(batches, "Arsenal", "2025-08-08");
  assert.equal(rest, 3);
  assert.equal(estimateRestDays(batches, "Unknown FC", "2025-08-08"), null);
}

// --- Full orchestration + manual override ---------------------------------
{
  const leagueHalfShare: HshLeagueHalfShare = {
    sample: 50,
    league1hShare: 0.45,
    league2hShare: 0.55,
    leagueAvgGoals: 2.6,
  };
  const thinShare = computeTeamHalfShare([], "Nobody FC", "home");

  const prediction = predictHighestScoringHalf({
    matchId: "m1",
    homeTeam: "Team A",
    awayTeam: "Team B",
    league: "Premier League",
    xgHome: 1.5,
    xgAway: 1.2,
    homeHalfShare: thinShare,
    awayHalfShare: thinShare,
    leagueHalfShare,
  });

  assert.equal(prediction.confidence, "low", "no historical half data means low confidence");
  assert.equal(prediction.usedManualOverride, false);
  assert.ok(Math.abs(prediction.p1h + prediction.p2h + prediction.pTie - 1) < 1e-9);

  const overridden = predictHighestScoringHalf({
    matchId: "m1",
    homeTeam: "Team A",
    awayTeam: "Team B",
    league: "Premier League",
    xgHome: 1.5,
    xgAway: 1.2,
    homeHalfShare: thinShare,
    awayHalfShare: thinShare,
    leagueHalfShare,
    manualLambda1h: 0.4,
    manualLambda2h: 2.0,
  });
  assert.equal(overridden.usedManualOverride, true);
  assert.equal(overridden.lambda1h, 0.4);
  assert.equal(overridden.lambda2h, 2.0);
  assert.equal(overridden.recommended, "2H");
}

assert.equal(topProbability({ p1h: 0.2, p2h: 0.5, pTie: 0.3 }), 0.5);

console.log("hsh-model tests passed");
