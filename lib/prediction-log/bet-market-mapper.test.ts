import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyBetPickToLogMatch,
  isBetPickMappable,
  mapBetMarketToLog,
} from "./bet-market-mapper";
import type { LogMatch } from "./types";

function baseMatch(): LogMatch {
  return {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    league: "Premier League",
    apiFixtureId: 123,
    predictions: {},
    actualResults: {},
    scored: {},
  };
}

test("mapBetMarketToLog maps 1X2 and DC", () => {
  assert.deepEqual(mapBetMarketToLog({ marketType: "1X2", selectionLabel: "Home" }), {
    mode: "single",
    marketKey: "1x2",
    prediction: "home",
  });
  assert.deepEqual(mapBetMarketToLog({ marketType: "DC", selectionLabel: "1X" }), {
    mode: "single",
    marketKey: "double_chance",
    prediction: "1x",
  });
});

test("mapBetMarketToLog maps O/U with line", () => {
  assert.deepEqual(mapBetMarketToLog({ marketType: "OU_2_5", selectionLabel: "Over" }), {
    mode: "single",
    marketKey: "total_goals_ou",
    prediction: "over",
    line: 2.5,
  });
});

test("mapBetMarketToLog maps BTTS and half markets", () => {
  assert.deepEqual(mapBetMarketToLog({ marketType: "BTTS", selectionLabel: "Yes" }), {
    mode: "single",
    marketKey: "btts",
    prediction: "yes",
  });
  assert.deepEqual(
    mapBetMarketToLog({ marketType: "HALF_MOST_GOALS", selectionLabel: "2H" }),
    { mode: "single", marketKey: "more_goals_half", prediction: "second_half" }
  );
});

test("mapBetMarketToLog maps combo RESULT_BTTS and RESULT_OU_2_5", () => {
  assert.deepEqual(
    mapBetMarketToLog({ marketType: "RESULT_BTTS", selectionLabel: "Home/Yes" }),
    { mode: "combined", comboId: "home_btts_yes" }
  );
  assert.deepEqual(
    mapBetMarketToLog({ marketType: "RESULT_OU_2_5", selectionLabel: "Draw/Under" }),
    { mode: "combined", comboId: "draw_under_2_5" }
  );
});

test("DNB and half O/U are unmapped", () => {
  assert.equal(isBetPickMappable({ marketType: "DNB", selectionLabel: "Home" }), false);
  assert.equal(
    isBetPickMappable({ marketType: "1H_OU_0_5", selectionLabel: "Over" }),
    false
  );
});

test("applyBetPickToLogMatch writes single and combo legs", () => {
  const single = applyBetPickToLogMatch(
    baseMatch(),
    { marketType: "1X2", selectionLabel: "Away" },
    2.1
  );
  assert.ok(single.mapping);
  assert.equal(single.match.marketMode, "single");
  assert.equal(single.match.predictions["1x2"]?.prediction, "away");
  assert.equal(single.match.predictions["1x2"]?.odds, 2.1);

  const combo = applyBetPickToLogMatch(
    baseMatch(),
    { marketType: "RESULT_BTTS", selectionLabel: "Away/No" },
    3.0
  );
  assert.equal(combo.match.marketMode, "combined");
  assert.equal(combo.match.comboPick?.comboId, "away_btts_no");
  assert.equal(combo.match.comboPick?.odds, 3);
});
