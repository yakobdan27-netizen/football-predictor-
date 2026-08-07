/**
 * Run: npx tsx lib/bets/evaluate.test.ts
 */
import assert from "node:assert/strict";
import { evaluate } from "./evaluate";

const ft = {
  homeGoals: 2,
  awayGoals: 1,
  homeGoals1h: 1,
  awayGoals1h: 0,
  status: "FT",
};

assert.equal(evaluate("1X2", "Home", ft), "WON");
assert.equal(evaluate("1X2", "Draw", ft), "LOST");
assert.equal(evaluate("1X2", "Away", ft), "LOST");
assert.equal(evaluate("OU_2_5", "Over", ft), "WON");
assert.equal(evaluate("OU_2_5", "Under", ft), "LOST");
assert.equal(evaluate("OU_0_5", "Over", ft), "WON");
assert.equal(evaluate("OU_3_5", "Under", ft), "WON");
assert.equal(evaluate("BTTS", "Yes", ft), "WON");
assert.equal(evaluate("BTTS", "No", ft), "LOST");
assert.equal(evaluate("DC", "1X", ft), "WON");
assert.equal(evaluate("DC", "X2", ft), "LOST");
assert.equal(evaluate("DNB", "Home", ft), "WON");
assert.equal(evaluate("DNB", "Away", ft), "LOST");
assert.equal(
  evaluate("DNB", "Home", { ...ft, homeGoals: 1, awayGoals: 1 }),
  "VOID"
);
assert.equal(evaluate("1H_1X2", "Home", ft), "WON");
assert.equal(evaluate("1H_OU_0_5", "Over", ft), "WON");
assert.equal(evaluate("1H_OU_1_5", "Under", ft), "WON");
assert.equal(evaluate("2H_OU_0_5", "Over", ft), "WON");
assert.equal(evaluate("2H_OU_1_5", "Over", ft), "WON");
assert.equal(evaluate("2H_OU_1_5", "Under", ft), "LOST");
assert.equal(evaluate("HALF_MOST_GOALS", "2H", ft), "WON");
assert.equal(evaluate("HALF_MOST_GOALS", "1H", ft), "LOST");
assert.equal(evaluate("HALF_MOST_GOALS", "Equal", ft), "LOST");
assert.equal(evaluate("RESULT_BTTS", "Home/Yes", ft), "WON");
assert.equal(evaluate("RESULT_BTTS", "Home/No", ft), "LOST");
assert.equal(evaluate("RESULT_OU_2_5", "Home/Over", ft), "WON");
assert.equal(evaluate("RESULT_OU_2_5", "Home/Under", ft), "LOST");
assert.equal(
  evaluate("1H_OU_0_5", "Over", {
    ...ft,
    homeGoals1h: null,
    awayGoals1h: null,
  }),
  "VOID"
);
assert.equal(
  evaluate("HALF_MOST_GOALS", "1H", {
    ...ft,
    homeGoals1h: null,
    awayGoals1h: null,
  }),
  "VOID"
);
assert.equal(evaluate("UNKNOWN", "Home", ft), "VOID");

console.log("bets evaluate tests passed");
