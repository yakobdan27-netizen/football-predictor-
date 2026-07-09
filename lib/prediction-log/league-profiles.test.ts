import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyLeagueAdjustToPSignal,
  LEAGUE_ADJUST_CAP,
} from "./league-character";
import {
  confidenceLevel,
  emptyLeagueCharacterProfile,
  recomputeLeagueProfiles,
  saveManualLeagueField,
} from "./league-profiles";
import { leagueProfileKey } from "./season";
import {
  applyHalfTimeGoalsToActualsFromStats,
  bothHalfTimeGoalsSet,
} from "./goal-result-sync";
import type { LeagueCharacterProfile, LogMatch, PredictionBatch } from "./types";

function makeMatch(
  homeFt: number,
  awayFt: number,
  homeHt?: number,
  awayHt?: number
): LogMatch {
  return {
    id: "m1",
    homeTeam: "Alpha",
    awayTeam: "Beta",
    predictions: { "1x2": { prediction: "home", confidence: 60 } },
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: homeFt, firstHalfGoals: homeHt },
      away: { goals: awayFt, firstHalfGoals: awayHt },
    },
  };
}

function makeBatch(league: string, matches: LogMatch[]): PredictionBatch {
  return {
    id: "b1",
    date: "2025-09-15",
    league,
    batchName: "Test",
    createdAt: "2025-09-15T12:00:00Z",
    matches,
  };
}

test("recomputeLeagueProfiles computes goals and half dominance with HT goals", () => {
  const matches: LogMatch[] = [
    makeMatch(2, 1, 1, 0),
    makeMatch(0, 2, 0, 1),
    makeMatch(3, 2, 2, 1),
    makeMatch(1, 1, 0, 1),
    makeMatch(2, 0, 1, 0),
  ];
  const store = recomputeLeagueProfiles([makeBatch("Premier League", matches)]);
  const key = leagueProfileKey("premier_league", "2025/26");
  const league = store.leagues[key];
  assert.ok(league);
  assert.equal(league.matchesLogged, 5);
  assert.ok(league.characterProfile.goals_per_match_avg.value != null);
  assert.ok(league.characterProfile.first_half_goals_avg.value != null);
  assert.ok(league.characterProfile.half_dominance.value != null);
});

test("manual override merge preserves flagged fields on recompute", () => {
  const matches: LogMatch[] = Array.from({ length: 6 }, (_, i) =>
    makeMatch(2, 1, 1, 0)
  );
  let store = recomputeLeagueProfiles([makeBatch("Premier League", matches)]);
  const key = leagueProfileKey("premier_league", "2025/26");
  store = saveManualLeagueField(store, key, "btts_rate", 72);
  const recomputed = recomputeLeagueProfiles([makeBatch("Premier League", matches)], store);
  const trait = recomputed.leagues[key]!.characterProfile.btts_rate;
  assert.equal(trait.value, 72);
  assert.equal(trait.manual, true);
});

test("applyLeagueAdjustToPSignal respects cap", () => {
  const profile: LeagueCharacterProfile = {
    ...emptyLeagueCharacterProfile(),
    btts_rate: { value: 80, baselineDelta: 50, sampleSize: 20 },
    favourite_reliability: { value: 80, baselineDelta: 40, sampleSize: 20 },
    home_advantage_index: { value: 2, baselineDelta: 1, sampleSize: 20 },
    goals_per_match_avg: { value: 3.5, baselineDelta: 1, sampleSize: 20 },
    tempo_index: { value: 10, baselineDelta: 5, sampleSize: 20 },
    half_dominance: { value: 1.5, baselineDelta: 0.5, sampleSize: 20 },
  };
  const base = 50;
  const { pSignal } = applyLeagueAdjustToPSignal(base, profile, "btts");
  assert.ok(Math.abs(pSignal - base) <= LEAGUE_ADJUST_CAP * 100 + 1);
});

test("confidenceLevel thresholds", () => {
  assert.equal(confidenceLevel(5), "low");
  assert.equal(confidenceLevel(20), "medium");
  assert.equal(confidenceLevel(55), "high");
});

test("HT goal sync derives ht_1x2 from stats", () => {
  const match: LogMatch = {
    id: "m1",
    homeTeam: "A",
    awayTeam: "B",
    predictions: {
      ht_1x2: { prediction: "home", confidence: 55 },
      "1x2": { prediction: "home", confidence: 60 },
    },
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: 2, firstHalfGoals: 1 },
      away: { goals: 1, firstHalfGoals: 0 },
    },
  };
  assert.equal(bothHalfTimeGoalsSet(match), true);
  const actuals = applyHalfTimeGoalsToActualsFromStats(match);
  assert.equal(actuals.ht_1x2?.actual, "home");
});
