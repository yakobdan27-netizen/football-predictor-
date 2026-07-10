import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ABNORMAL_MATCH_WEIGHT,
  matchLearningWeight,
  resolveFirstGoalSide,
} from "./match-learning";
import { parsePastedResultGrid } from "./parse-pasted-rows";
import { RESULT_CORE_FIELDS } from "./result-grid-fields";
import { applyTeamStatsSync, setHomePossession } from "./team-stats-sync";
import type { LogMatch } from "./types";

function baseMatch(overrides: Partial<LogMatch> = {}): LogMatch {
  return {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    predictions: {
      "1x2": { prediction: "home", confidence: 60 },
      shots_ou: { prediction: "over", line: 20.5, confidence: 55 },
    },
    actualResults: {},
    scored: {},
    teamStats: { home: {}, away: {} },
    ...overrides,
  };
}

test("setHomePossession complements away to 100 − home", () => {
  const m = setHomePossession(baseMatch(), 58);
  assert.equal(m.teamStats?.home?.possession, 58);
  assert.equal(m.teamStats?.away?.possession, 42);
});

test("applyTeamStatsSync still scores FT + home/away shots", () => {
  const m = applyTeamStatsSync(
    baseMatch({
      predictions: {
        "1x2": { prediction: "home", confidence: 60 },
        shots_ou: { prediction: "under", line: 25.5, confidence: 55 },
        home_shots_ou: { prediction: "over", line: 10.5, confidence: 50 },
        away_shots_ou: { prediction: "under", line: 12.5, confidence: 50 },
      },
      teamStats: {
        home: { goals: 2, totalShots: 14 },
        away: { goals: 1, totalShots: 9 },
      },
    })
  );
  assert.equal(m.actualResults["1x2"]?.actual, "home");
  assert.equal(m.scored["1x2"], "correct");
  assert.equal(m.actualResults.shots_ou?.actual, 23);
  assert.equal(m.scored.shots_ou, "correct");
  assert.equal(m.actualResults.home_shots_ou?.actual, 14);
  assert.equal(m.actualResults.away_shots_ou?.actual, 9);
});

test("resolveFirstGoalSide prefers explicit firstGoalSide over HT proxy", () => {
  const withExplicit = baseMatch({
    teamStats: {
      home: { goals: 2, firstHalfGoals: 0 },
      away: { goals: 1, firstHalfGoals: 1 },
      firstGoalSide: "home",
    },
  });
  assert.equal(resolveFirstGoalSide(withExplicit), "home");

  const htProxy = baseMatch({
    teamStats: {
      home: { goals: 2, firstHalfGoals: 0 },
      away: { goals: 1, firstHalfGoals: 1 },
    },
  });
  assert.equal(resolveFirstGoalSide(htProxy), "away");
});

test("matchLearningWeight returns 0.25 for abnormal matches", () => {
  assert.equal(matchLearningWeight(undefined), 1);
  assert.equal(matchLearningWeight({ home: {}, away: {} }), 1);
  assert.equal(
    matchLearningWeight({ home: {}, away: {}, abnormalMatch: true }),
    ABNORMAL_MATCH_WEIGHT
  );
  assert.equal(ABNORMAL_MATCH_WEIGHT, 0.25);
});

test("parsePastedResultGrid maps HT/FT TSV from focused cell", () => {
  const patches = parsePastedResultGrid(
    "1\t0\t2\t1\n0\t0\t1\t1",
    "htH",
    [...RESULT_CORE_FIELDS]
  );
  assert.equal(patches.length, 2);
  assert.deepEqual(patches[0], { htH: "1", htA: "0", ftH: "2", ftA: "1" });
  assert.deepEqual(patches[1], { htH: "0", htA: "0", ftH: "1", ftA: "1" });
});
