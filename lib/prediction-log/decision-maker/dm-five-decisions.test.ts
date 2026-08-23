import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComboCandidate } from "../combo-selection";
import {
  comboOverlapsTopThree,
  pickMandatoryCombo,
  relatedMarketKeysForCombo,
} from "./combo-exclude";
import {
  buildUserMarketEvaluation,
  computeRowConfidenceScore,
  USER_MARKET_EVAL_MAX_COMMENT,
} from "./user-market-evaluation";
import type { ScoredDecisionMarket } from "./types";
import type { LogMatch } from "../types";

function cand(comboId: string, pFinal: number): ComboCandidate {
  return {
    comboId,
    label: comboId,
    pGrid: pFinal,
    pFinal,
    odds: null,
    value: null,
  };
}

test("relatedMarketKeysForCombo maps common combo families", () => {
  assert.ok(relatedMarketKeysForCombo("home_over_2_5").includes("1x2"));
  assert.ok(relatedMarketKeysForCombo("home_over_2_5").includes("total_goals_ou"));
  assert.ok(relatedMarketKeysForCombo("btts_yes_over_2_5").includes("btts"));
  assert.ok(relatedMarketKeysForCombo("1x_btts_yes").includes("double_chance"));
});

test("pickMandatoryCombo prefers non-overlapping then falls back", () => {
  const evaluated = [
    cand("home_over_2_5", 80),
    cand("btts_yes_over_2_5", 70),
    cand("12_btts_yes", 65),
  ];
  // Top-3 has 1x2 + corners — home_over and 12_btts overlap 1x2; btts+over does not
  const picked = pickMandatoryCombo(evaluated, ["1x2", "corners_ou", "hsh"]);
  assert.ok(picked);
  assert.equal(picked!.comboId, "btts_yes_over_2_5");

  // Everything overlaps → still return absolute best
  const allOverlap = pickMandatoryCombo(evaluated, [
    "1x2",
    "btts",
    "total_goals_ou",
    "double_chance",
  ]);
  assert.ok(allOverlap);
  assert.equal(allOverlap!.comboId, "home_over_2_5");
  assert.equal(pickMandatoryCombo([], ["1x2"]), null);
});

test("comboOverlapsTopThree is false when no related keys match", () => {
  assert.equal(comboOverlapsTopThree("home_over_2_5", ["corners_ou", "hsh"]), false);
  assert.equal(comboOverlapsTopThree("home_over_2_5", ["1x2"]), true);
});

function emptyMatch(preds: LogMatch["predictions"] = {}): LogMatch {
  return {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    league: "Premier League",
    predictions: preds,
    actualResults: {},
    scored: {},
  };
}

function scored(
  marketKey: string,
  confidence: number,
  prediction = "x"
): ScoredDecisionMarket {
  return {
    marketKey,
    label: marketKey,
    prediction,
    confidence,
    category: "goals",
    pageId: "test",
    pageLabel: "Test",
    totalScore: confidence,
    contributingPages: ["test"],
  };
}

test("buildUserMarketEvaluation none when no predictions", () => {
  const evalRow = buildUserMarketEvaluation({
    match: emptyMatch(),
    systemPick: scored("1x2", 70, "Home"),
  });
  assert.equal(evalRow.status, "none");
  assert.equal(evalRow.comment, "No user market selected");
});

test("buildUserMarketEvaluation filled with comment ≤140 and %", () => {
  const match = emptyMatch({
    total_goals_ou: { prediction: "over", line: 2.5, confidence: 55 },
  });
  const evalRow = buildUserMarketEvaluation({
    match,
    systemPick: scored("corners_ou", 80, "Over 9.5"),
    systemProbabilityPct: 67,
  });
  assert.equal(evalRow.status, "filled");
  assert.equal(evalRow.probabilityPct, 67);
  assert.ok(evalRow.comment.length <= USER_MARKET_EVAL_MAX_COMMENT);
  assert.ok(evalRow.predictionLabel);
});

test("buildUserMarketEvaluation marks optimal when user matches system pick", () => {
  const match = emptyMatch({
    "1x2": { prediction: "home", confidence: 72 },
  });
  const evalRow = buildUserMarketEvaluation({
    match,
    systemPick: scored("1x2", 75, "Home"),
    systemProbabilityPct: 75,
  });
  assert.equal(evalRow.status, "filled");
  assert.ok(evalRow.comment.toLowerCase().includes("align") || evalRow.comment.length > 0);
});

test("computeRowConfidenceScore averages available parts", () => {
  const score = computeRowConfidenceScore({
    bestMarket: scored("1x2", 80),
    comboPFinal: 50,
    userEval: { status: "none", comment: "No user market selected" },
  });
  assert.equal(score, Math.round((80 + 50) / 2));
});
