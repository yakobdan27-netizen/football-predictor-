/**
 * Run: npx tsx lib/prediction-log/hsh-model.test.ts
 */
import assert from "node:assert/strict";
import {
  computeAttackDefenceStageA,
  computeLeagueHalfShare,
  computeStageB,
  computeTeamHalfShare,
  confidenceBandFromMargin,
  estimateRestDays,
  pickBatchBestHsh,
  predictHighestScoringHalf,
  recommendedHalf,
  skellamHeadline,
  topProbability,
  type HshPrediction,
} from "./hsh-model";
import type { ClubHalfAttackDefence } from "./hsh-half-rates";
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

function ratesFromCoeffs(
  clubName: string,
  league: string,
  att1: number,
  att2: number,
  def1: number,
  def2: number,
  lgAf1: number,
  lgAf2: number,
  opts?: Partial<ClubHalfAttackDefence>
): ClubHalfAttackDefence {
  return {
    clubName,
    league,
    af1: att1 * lgAf1,
    af2: att2 * lgAf2,
    da1: def1 * lgAf1,
    da2: def2 * lgAf2,
    nMatches: 40,
    seasonCount: 5,
    seedOnly: false,
    sourceNote: "test",
    ...opts,
  };
}

// --- §8 City vs Everton worked example ------------------------------------
{
  const lgAf1 = 0.62;
  const lgAf2 = 0.78;
  const city = ratesFromCoeffs("Manchester City", "Premier League", 1.35, 1.55, 0.7, 0.65, lgAf1, lgAf2);
  const everton = ratesFromCoeffs("Everton", "Premier League", 0.85, 0.95, 1.2, 1.3, lgAf1, lgAf2);

  const stageA = computeAttackDefenceStageA({ home: city, away: everton, lgAf1, lgAf2 });

  assert.ok(Math.abs(stageA.lambdaA1 - 1.104) < 0.02, `λ_City1 ~1.104, got ${stageA.lambdaA1}`);
  assert.ok(Math.abs(stageA.lambdaB1 - 0.351) < 0.02, `λ_Evr1 ~0.351, got ${stageA.lambdaB1}`);
  assert.ok(Math.abs(stageA.lambda1h - 1.455) < 0.05, `Λ1 ~1.455, got ${stageA.lambda1h}`);
  // Uncoupled Λ2 ≈ 2.187; coupling nudges slightly (still within ±0.05)
  assert.ok(Math.abs(stageA.lambda2h - 2.187) < 0.05, `Λ2 ~2.187, got ${stageA.lambda2h}`);

  const { expectedDiff } = skellamHeadline(stageA.lambda1h, stageA.lambda2h);
  assert.ok(expectedDiff < 0, "E[D] negative → lean 2H");

  const stageB = computeStageB(stageA.lambda1h, stageA.lambda2h);
  assert.equal(recommendedHalf(stageB), "2H");
  assert.ok(Math.abs(stageB.p2h - 0.55) < 0.08, `p2h ~0.55, got ${stageB.p2h}`);
  assert.ok(Math.abs(stageB.p1h - 0.29) < 0.08, `p1h ~0.29, got ${stageB.p1h}`);
  assert.ok(Math.abs(stageB.pTie - 0.16) < 0.08, `pTie ~0.16, got ${stageB.pTie}`);
  assert.ok(Math.abs(stageB.p1h + stageB.p2h + stageB.pTie - 1) < 1e-9);

  const pred = predictHighestScoringHalf({
    matchId: "city-evr",
    homeTeam: "Manchester City",
    awayTeam: "Everton",
    league: "Premier League",
    homeRates: city,
    awayRates: everton,
    lgAf1,
    lgAf2,
  });
  assert.equal(pred.recommended, "2H");
  assert.ok(pred.expectedDiff < 0);
  assert.ok(pred.margin > 0);
}

// --- Stage B: τ increases tie vs untuned ----------------------------------
{
  const withTau = computeStageB(1.2, 1.2, 8, { applyTau: true });
  const noTau = computeStageB(1.2, 1.2, 8, { applyTau: false });
  assert.ok(withTau.pTie > noTau.pTie, "τ should raise P(Tie)");
  assert.ok(Math.abs(withTau.p1h + withTau.p2h + withTau.pTie - 1) < 1e-9);
}

// --- Stage B sanity: symmetric lambdas favour a tie more than skewed ones
{
  const symmetric = computeStageB(1.2, 1.2);
  const skewed = computeStageB(0.3, 2.5);
  assert.ok(symmetric.pTie > skewed.pTie, "closer lambdas should yield a higher tie probability");
}

// --- Confidence banding (margin rules) ------------------------------------
assert.equal(confidenceBandFromMargin(0.16, 3, 3, false, false), "high");
assert.equal(confidenceBandFromMargin(0.16, 2, 3, false, false), "medium", "seasons <3 blocks high");
assert.equal(confidenceBandFromMargin(0.1, 5, 5, false, false), "medium");
assert.equal(confidenceBandFromMargin(0.05, 5, 5, false, false), "low");
assert.equal(confidenceBandFromMargin(0.2, 5, 5, true, false), "low", "seed-only forces low");
assert.equal(confidenceBandFromMargin(0.2, 5, 5, false, true), "low");

// --- Team half share from synthetic batches (helpers still used by cache) --
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
  const thin: ClubHalfAttackDefence = {
    clubName: "Nobody FC",
    league: "Premier League",
    af1: 0.55,
    af2: 0.75,
    da1: 0.55,
    da2: 0.75,
    nMatches: 0,
    seasonCount: 0,
    seedOnly: true,
    sourceNote: "seed-only",
  };

  const prediction = predictHighestScoringHalf({
    matchId: "m1",
    homeTeam: "Team A",
    awayTeam: "Team B",
    league: "Premier League",
    homeRates: thin,
    awayRates: thin,
    lgAf1: 0.62,
    lgAf2: 0.78,
  });

  assert.equal(prediction.confidence, "low", "seed-only means low confidence");
  assert.equal(prediction.usedManualOverride, false);
  assert.ok(Math.abs(prediction.p1h + prediction.p2h + prediction.pTie - 1) < 1e-9);

  const overridden = predictHighestScoringHalf({
    matchId: "m1",
    homeTeam: "Team A",
    awayTeam: "Team B",
    league: "Premier League",
    homeRates: thin,
    awayRates: thin,
    lgAf1: 0.62,
    lgAf2: 0.78,
    manualLambda1h: 0.4,
    manualLambda2h: 2.0,
  });
  assert.equal(overridden.usedManualOverride, true);
  assert.equal(overridden.lambda1h, 0.4);
  assert.equal(overridden.lambda2h, 2.0);
  assert.equal(overridden.recommended, "2H");
}

// --- Tempo nudges raise λ when fast-start / late-surge flags are set ------
{
  const home = ratesFromCoeffs("Team A", "Premier League", 1.1, 1.0, 0.95, 1.0, 0.62, 0.78);
  const away = ratesFromCoeffs("Team B", "Premier League", 0.95, 1.05, 1.0, 0.95, 0.62, 0.78);
  const baseline = predictHighestScoringHalf({
    matchId: "tempo-base",
    homeTeam: "Team A",
    awayTeam: "Team B",
    league: "Premier League",
    homeRates: home,
    awayRates: away,
    lgAf1: 0.62,
    lgAf2: 0.78,
  });
  const boosted = predictHighestScoringHalf({
    matchId: "tempo-boost",
    homeTeam: "Team A",
    awayTeam: "Team B",
    league: "Premier League",
    homeRates: home,
    awayRates: away,
    lgAf1: 0.62,
    lgAf2: 0.78,
    homeTempo: {
      sampleWithTiming: 8,
      fastStartRate: 0.5,
      lateSurgeRate: 0.4,
      paceProxy: 10,
      isFastStarter: true,
      isLateSurger: true,
    },
    awayTempo: {
      sampleWithTiming: 8,
      fastStartRate: 0.1,
      lateSurgeRate: 0.1,
      paceProxy: 40,
      isFastStarter: false,
      isLateSurger: false,
    },
  });
  assert.ok(boosted.lambda1h > baseline.lambda1h);
  assert.ok(boosted.lambda2h > baseline.lambda2h);
  assert.equal(boosted.detail.tempoBoost1h, true);
  assert.equal(boosted.detail.lateSurgeBoost2h, true);
  assert.equal(boosted.detail.fatigueBoost2h, true);
  assert.ok(boosted.tacticalNote.length > 0);
  assert.ok(Math.abs(boosted.p1h + boosted.p2h + boosted.pTie - 1) < 1e-9);
}

// --- Batch-best picks highest margin × conf weight ------------------------
{
  const base = {
    homeTeam: "A",
    awayTeam: "B",
    league: "PL",
    lambda1h: 1,
    lambda2h: 1.5,
    p1h: 0.3,
    p2h: 0.5,
    pTie: 0.2,
    recommended: "2H" as const,
    topProbability: 0.5,
    expectedDiff: -0.5,
    seDiff: 1,
    sampleSizeHome: 10,
    sampleSizeAway: 10,
    usedManualOverride: false,
    valueAlert: false,
    tacticalNote: "test",
    detail: {
      lambdaA1: 0.5,
      lambdaB1: 0.5,
      lambdaA2: 0.7,
      lambdaB2: 0.8,
      att1Home: 1,
      att2Home: 1,
      def1Home: 1,
      def2Home: 1,
      att1Away: 1,
      att2Away: 1,
      def1Away: 1,
      def2Away: 1,
      lgAf1: 0.62,
      lgAf2: 0.78,
      couplingApplied: true,
    },
  };
  const preds: HshPrediction[] = [
    { ...base, matchId: "low", confidence: "low", margin: 0.2 },
    { ...base, matchId: "high", confidence: "high", margin: 0.12 },
    { ...base, matchId: "med", confidence: "medium", margin: 0.15 },
  ];
  // high: 0.12*1=0.12; med: 0.15*0.7=0.105; low: 0.2*0.4=0.08
  assert.equal(pickBatchBestHsh(preds)?.matchId, "high");
}

assert.equal(topProbability({ p1h: 0.2, p2h: 0.5, pTie: 0.3 }), 0.5);

console.log("hsh-model tests passed");
