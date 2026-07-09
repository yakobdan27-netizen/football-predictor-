import assert from "node:assert/strict";
import { jointProbPercent } from "@/lib/predictor/score-matrix";
import { comboGridProbabilityPercent } from "./combo-markets-config";
import {
  computeEntryLegProbability,
  entryValueFromGrid,
  formatValueEdge,
} from "./combo-entry-probability";
import { switchMarketMode, validateMatchLeg } from "./match-entry-helpers";
import type { LogMatch } from "./types";

const grid = [
  [0.05, 0.08, 0.04],
  [0.1, 0.12, 0.06],
  [0.15, 0.18, 0.08],
];
const total = grid.flat().reduce((a, b) => a + b, 0);
const normGrid = grid.map((row) => row.map((v) => v / total));

const expectedHomeBtts = jointProbPercent(normGrid, (h, a) => h > a && h >= 1 && a >= 1);
const fromCatalog = comboGridProbabilityPercent("home_btts_yes", { grid: normGrid });
assert.equal(fromCatalog, expectedHomeBtts);

const positiveValue = entryValueFromGrid(55, 2.0);
assert.ok(positiveValue != null && positiveValue > 0);

const negativeValue = entryValueFromGrid(40, 2.0);
assert.ok(negativeValue != null && negativeValue < 0);

const posFmt = formatValueEdge(9.2, true);
assert.ok(posFmt.text.includes("+"));
assert.equal(posFmt.color, "var(--accent)");

const negFmt = formatValueEdge(-5.1, true);
assert.ok(negFmt.text.includes("-"));
assert.equal(negFmt.color, "var(--danger)");

const baseMatch: LogMatch = {
  id: "m1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  predictions: { "1x2": { prediction: "home", confidence: 60, odds: 1.9 } },
  actualResults: {},
  scored: {},
  marketMode: "single",
};

const switched = switchMarketMode(baseMatch, "combined");
assert.equal(switched.marketMode, "combined");
assert.equal(Object.keys(switched.predictions).length, 0);
assert.ok(switched.comboPick);

const backToSingle = switchMarketMode(switched, "single");
assert.equal(backToSingle.marketMode, "single");
assert.equal(backToSingle.comboPick, undefined);

assert.equal(validateMatchLeg({ ...baseMatch, predictions: {} }), "Select a market.");
assert.equal(
  validateMatchLeg({
    ...baseMatch,
    predictions: {
      "1x2": { prediction: "home", confidence: 60 },
      btts: { prediction: "yes", confidence: 50 },
    },
  }),
  "Only one single market allowed per match."
);

const comboMatch: LogMatch = {
  ...baseMatch,
  marketMode: "combined",
  predictions: {},
  comboPick: { comboId: "home_btts_yes", odds: 2.1 },
};

const comboProb = computeEntryLegProbability(comboMatch, "Premier League", {}, null, []);
assert.ok(comboProb.pGrid == null || typeof comboProb.pGrid === "number");
assert.equal(comboProb.error, undefined);

assert.equal(validateMatchLeg(comboMatch), null);

console.log("combo-entry-probability.test.ts: all assertions passed");
