import assert from "node:assert/strict";
import { defaultCombinedOddsSettings } from "./combo-settings";
import {
  applyMarketOption,
  buildMarketOptions,
  marketOptionFromMatch,
} from "./batch-market-options";
import { parsePastedRows } from "./parse-pasted-rows";
import { resolveMarketMode } from "./match-entry-helpers";
import type { LogMatch } from "./types";

const settings = defaultCombinedOddsSettings();
const options = buildMarketOptions("Arsenal", "Chelsea", settings);

assert.ok(options.some((o) => o.kind === "single" && o.label.includes("1X2")));
assert.ok(options.some((o) => o.kind === "combo"));

const singleOpt = options.find((o) => o.kind === "single" && o.key === "1x2" && o.prediction === "home")!;
assert.ok(singleOpt);

const base: LogMatch = {
  id: "m1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: {},
  actualResults: {},
  scored: {},
};

const withSingle = applyMarketOption(base, singleOpt);
assert.equal(resolveMarketMode(withSingle), "single");
assert.equal(withSingle.predictions["1x2"]?.prediction, "home");

const comboOpt = options.find((o) => o.kind === "combo")!;
const withCombo = applyMarketOption(base, comboOpt);
assert.equal(resolveMarketMode(withCombo), "combined");
assert.ok(withCombo.comboPick?.comboId);

assert.equal(marketOptionFromMatch(withSingle, "Arsenal", "Chelsea"), singleOpt.value);

const pasted = parsePastedRows("Arsenal\tChelsea\nLiverpool, Man City");
assert.equal(pasted.length, 2);
assert.equal(pasted[0]!.home, "Arsenal");
assert.equal(pasted[0]!.away, "Chelsea");

console.log("batch-market-options.test.ts: all passed");
