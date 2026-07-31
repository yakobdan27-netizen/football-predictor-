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
assert.equal(evaluate("BTTS", "Yes", ft), "WON");
assert.equal(evaluate("BTTS", "No", ft), "LOST");
assert.equal(evaluate("DC", "1X", ft), "WON");
assert.equal(evaluate("DC", "X2", ft), "LOST");
assert.equal(evaluate("1H_OU_0_5", "Over", ft), "WON");
assert.equal(
  evaluate("1H_OU_0_5", "Over", { ...ft, homeGoals1h: null, awayGoals1h: null }),
  "VOID"
);
assert.equal(evaluate("UNKNOWN", "Home", ft), "VOID");

console.log("bets evaluate tests passed");
