import assert from "node:assert/strict";
import {
  computeLeagueHalfAverages,
  computeStageA,
  computeStageB,
  computeTeamHalfAverages,
  confidenceBand,
  estimateTempoProfile,
  getRecommendation,
  predictHalfComparison,
  type HcLeagueHalfAverages,
  type HcTeamHalfAverages,
  type HcTempoProfile,
} from "./half-comparison-model";
import type { PredictionBatch } from "./types";

function emptyTempo(): HcTempoProfile {
  return {
    sampleWithTiming: 0,
    fastStartRate: null,
    lateSurgeRate: null,
    paceProxy: null,
    isFastStarter: false,
    isLateSurger: false,
  };
}

// --- El Clásico-style Stage A (brief worked example, order of magnitude) ---
{
  const homeAvg: HcTeamHalfAverages = {
    sample: 12,
    avg1hScored: 1.25,
    avg2hScored: 1.42,
    avg1hConceded: 1.18,
    avg2hConceded: 1.38,
    std1hScored: 0.8,
    std2hScored: 0.9,
  };
  // Brief used opp conceded ≈ opposite team's scored for the worked numbers
  const awayAvg: HcTeamHalfAverages = {
    sample: 12,
    avg1hScored: 1.18,
    avg2hScored: 1.38,
    avg1hConceded: 1.25,
    avg2hConceded: 1.42,
    std1hScored: 0.7,
    std2hScored: 0.85,
  };
  const leagueAvg: HcLeagueHalfAverages = {
    sample: 0,
    avg1h: 1.08,
    avg2h: 1.42,
    ratio: 1.08 / 1.42,
    source: "fallback",
  };
  const homeTempo: HcTempoProfile = {
    ...emptyTempo(),
    sampleWithTiming: 8,
    paceProxy: 24,
    isFastStarter: true,
    isLateSurger: false,
  };
  const awayTempo = emptyTempo();

  const stageA = computeStageA({
    homeAvg,
    awayAvg,
    leagueAvg,
    homeTempo,
    awayTempo,
  });

  assert.ok(stageA.tempoBoost1h);
  assert.ok(stageA.fatigueBoost2h);
  // Brief: after tempo ~2.55 / ~2.95 — allow tolerance
  assert.ok(stageA.lambda1h > 2.2 && stageA.lambda1h < 2.9, `λ1h=${stageA.lambda1h}`);
  assert.ok(stageA.lambda2h > 2.5 && stageA.lambda2h < 3.3, `λ2h=${stageA.lambda2h}`);
  assert.ok(stageA.lambda2h > stageA.lambda1h);

  const stageB = computeStageB(stageA.lambda1h, stageA.lambda2h);
  assert.equal(getRecommendation(stageB), "2h_greater");
  assert.ok(stageB.p2hGreater > stageB.p1hGreater);
  assert.ok(stageB.p2hGreater > stageB.pEqual);
  const sum = stageB.p1hGreater + stageB.pEqual + stageB.p2hGreater;
  assert.ok(Math.abs(sum - 1) < 1e-9);
}

// --- Stage B sanity ---
{
  const symmetric = computeStageB(1.5, 1.5);
  assert.ok(Math.abs(symmetric.p1hGreater - symmetric.p2hGreater) < 0.02);
  assert.ok(symmetric.pEqual > 0.1);

  const skewed = computeStageB(1.0, 2.5);
  assert.ok(skewed.p2hGreater > skewed.p1hGreater);
  assert.equal(getRecommendation(skewed), "2h_greater");
}

// --- Confidence bands ---
{
  assert.equal(confidenceBand(0.65), "very_high");
  assert.equal(confidenceBand(0.55), "high");
  assert.equal(confidenceBand(0.45), "moderate");
  assert.equal(confidenceBand(0.35), "low");
}

// --- Team / league averages from synthetic batches ---
{
  function makeMatch(
    id: string,
    home: string,
    away: string,
    hFt: number,
    hHt: number,
    aFt: number,
    aHt: number
  ) {
    return {
      id,
      homeTeam: home,
      awayTeam: away,
      predictions: {},
      actualResults: {},
      scored: {},
      teamStats: {
        home: { goals: hFt, firstHalfGoals: hHt },
        away: { goals: aFt, firstHalfGoals: aHt },
      },
    };
  }

  const batches: PredictionBatch[] = [
    {
      id: "b1",
      date: "2026-01-10",
      league: "Premier League",
      batchName: "t1",
      createdAt: "2026-01-10T00:00:00Z",
      matches: [
        makeMatch("m1", "Arsenal", "Chelsea", 2, 1, 1, 0),
        makeMatch("m2", "Arsenal", "Everton", 3, 2, 0, 0),
      ],
    },
    {
      id: "b2",
      date: "2026-01-20",
      league: "Premier League",
      batchName: "t2",
      createdAt: "2026-01-20T00:00:00Z",
      matches: [makeMatch("m3", "Liverpool", "Arsenal", 1, 0, 2, 1)],
    },
  ];

  const homeAvg = computeTeamHalfAverages(batches, "Arsenal", "home", {
    beforeDate: "2026-02-01",
  });
  assert.equal(homeAvg.sample, 2);
  assert.ok(homeAvg.avg1hScored > 0);

  const league = computeLeagueHalfAverages(batches, "Premier League", {
    beforeDate: "2026-02-01",
  });
  // sample < 6 → fallback table still used for avgs but sample counted
  assert.ok(league.avg1h > 0 && league.avg2h > 0);

  const tempo = estimateTempoProfile(batches, "Arsenal");
  assert.equal(tempo.sampleWithTiming, 0);
  assert.equal(tempo.isFastStarter, false);
}

// --- Full orchestration + value alert ---
{
  const pred = predictHalfComparison({
    matchId: "x",
    homeTeam: "Real Madrid",
    awayTeam: "Barcelona",
    league: "La Liga",
    homeAvg: {
      sample: 10,
      avg1hScored: 1.25,
      avg2hScored: 1.42,
      avg1hConceded: 0.9,
      avg2hConceded: 1.0,
      std1hScored: 0.5,
      std2hScored: 0.6,
    },
    awayAvg: {
      sample: 10,
      avg1hScored: 1.18,
      avg2hScored: 1.38,
      avg1hConceded: 1.0,
      avg2hConceded: 1.1,
      std1hScored: 0.5,
      std2hScored: 0.6,
    },
    leagueAvg: {
      sample: 0,
      avg1h: 1.08,
      avg2h: 1.42,
      ratio: 0.76,
      source: "fallback",
    },
    homeTempo: {
      ...emptyTempo(),
      isFastStarter: true,
      paceProxy: 24,
      sampleWithTiming: 5,
    },
    awayTempo: emptyTempo(),
  });

  assert.equal(pred.recommendation, "2h_greater");
  assert.ok(pred.exp2h > pred.exp1h);
  assert.ok(pred.tacticalNote.length > 0);
  // 1H>2H often still > 30% even when 2H preferred → value alert advisory
  assert.equal(typeof pred.valueAlert, "boolean");
}

console.log("half-comparison-model tests passed");
