import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScoreMatrix } from "@/lib/predictor/score-matrix";
import {
  asianHandicapProb,
  asianHandicapResult,
  europeanHandicapProb,
  europeanHandicapResult,
  goalDifference,
} from "./handicap";
import { deriveActualsFromFacts, gradeMatchFromFacts } from "./grade-from-facts";
import { pickProbFromMatrix } from "./statistics-engine";
import { marketProbsFromMatrix } from "@/lib/predictor/score-matrix";
import { scoreMarket } from "./score-market";
import type { LogMatch } from "./types";

test("goal difference and asian handicap results", () => {
  assert.equal(goalDifference(2, 1), 1);
  assert.equal(asianHandicapResult(1, -0.5), "home");
  assert.equal(asianHandicapResult(1, -1), "push");
  assert.equal(asianHandicapResult(0, -0.5), "away");
});

test("european handicap results", () => {
  assert.equal(europeanHandicapResult(2, -1), "home");
  assert.equal(europeanHandicapResult(1, -1), "draw");
  assert.equal(europeanHandicapResult(0, -1), "away");
});

test("scoreMarket grades handicap from goal difference actual", () => {
  assert.equal(scoreMarket("handicap", "home", -0.5, 1), "correct");
  assert.equal(scoreMarket("handicap", "away", -0.5, 1), "wrong");
  assert.equal(scoreMarket("handicap", "home", -1, 1), "push");
  assert.equal(scoreMarket("three_way_handicap", "draw", -1, 1), "correct");
});

test("deriveActualsFromFacts fills new goal markets", () => {
  const match: LogMatch = {
    id: "m1",
    homeTeam: "A",
    awayTeam: "B",
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: 2, firstHalfGoals: 1 },
      away: { goals: 1, firstHalfGoals: 0 },
    },
  };
  const derived = deriveActualsFromFacts(match);
  assert.equal(derived.total_goals_ou?.actual, 3);
  assert.equal(derived.handicap?.actual, 1);
  assert.equal(derived.three_way_handicap?.actual, 1);
  assert.equal(derived.ht_handicap?.actual, 1);
});

test("gradeMatchFromFacts scores total goals O/U", () => {
  const graded = gradeMatchFromFacts({
    id: "m1",
    homeTeam: "A",
    awayTeam: "B",
    predictions: {
      total_goals_ou: { prediction: "over", line: 2.5, confidence: 60 },
    },
    actualResults: {},
    scored: {},
    teamStats: { home: { goals: 2 }, away: { goals: 1 } },
  });
  assert.equal(graded.scored.total_goals_ou, "correct");
});

test("pickProbFromMatrix supports total goals and handicap", () => {
  const grid = buildScoreMatrix(1.4, 1.1, -0.13, 8);
  const probs = marketProbsFromMatrix(grid);
  const over = pickProbFromMatrix(probs, "total_goals_ou", "over", 2.5);
  assert.ok(over > 0 && over < 1);
  const homeHc = pickProbFromMatrix(probs, "handicap", "home", -0.5, {
    scoreGrid: grid,
    lambdaHome: 1.4,
    lambdaAway: 1.1,
  });
  assert.ok(homeHc > 0 && homeHc < 1);
  assert.ok(Math.abs(homeHc - asianHandicapProb(grid, -0.5, "home")) < 1e-9);
  const euDraw = pickProbFromMatrix(probs, "three_way_handicap", "draw", -1, {
    scoreGrid: grid,
  });
  assert.ok(euDraw > 0 && euDraw < 1);
  assert.ok(Math.abs(euDraw - europeanHandicapProb(grid, -1, "draw")) < 1e-9);
});
