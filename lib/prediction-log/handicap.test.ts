import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScoreMatrix } from "@/lib/predictor/score-matrix";
import {
  asianHandicapProb,
  asianHandicapResult,
  canonicalHomeHandicapLine,
  directionallyValidHomeLines,
  europeanHandicapProb,
  europeanHandicapResult,
  formatHandicapLine,
  goalDifference,
  handicapAdjustedDiff,
  handicapLineRole,
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

test("explicit score table: Home -1.5 vs Home +1.5", () => {
  const cases: Array<{
    home: number;
    away: number;
    minus15: "home" | "away" | "push";
    plus15: "home" | "away" | "push";
  }> = [
    { home: 3, away: 1, minus15: "home", plus15: "home" },
    { home: 2, away: 1, minus15: "away", plus15: "home" },
    { home: 1, away: 2, minus15: "away", plus15: "home" },
    { home: 0, away: 2, minus15: "away", plus15: "away" },
  ];

  for (const c of cases) {
    const diff = goalDifference(c.home, c.away);
    assert.equal(
      asianHandicapResult(diff, -1.5),
      c.minus15,
      `3–1 style ${c.home}-${c.away} @ -1.5`
    );
    assert.equal(
      asianHandicapResult(diff, 1.5),
      c.plus15,
      `${c.home}-${c.away} @ +1.5`
    );
  }
});

test("handicap sign helpers", () => {
  assert.equal(handicapAdjustedDiff(1, -1.5), -0.5);
  assert.equal(handicapLineRole(-1.5), "giving");
  assert.equal(handicapLineRole(1.5), "receiving");
  assert.equal(handicapLineRole(0), "pickem");
  assert.equal(canonicalHomeHandicapLine(2), -1.5);
  assert.equal(canonicalHomeHandicapLine(-2), 1.5);
  assert.ok(formatHandicapLine(-1.5, { showRole: true }).includes("giving"));
  assert.deepEqual(
    directionallyValidHomeLines(1.5),
    [-2.5, -1.5, -0.5, 0]
  );
  assert.deepEqual(
    directionallyValidHomeLines(-1.5),
    [0, 0.5, 1.5, 2.5]
  );
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
  assert.equal(scoreMarket("handicap", "home", -1.5, 1), "wrong");
  assert.equal(scoreMarket("handicap", "home", 1.5, 1), "correct");
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
