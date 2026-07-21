import assert from "node:assert/strict";
import { test } from "node:test";
import { pickBestCombo, type ComboCandidate } from "./combo-selection";
import { DEFAULT_COMBO_TIER_MIN_PFINAL } from "./combo-settings";

function cand(
  comboId: string,
  pFinal: number,
  label = comboId
): ComboCandidate {
  return {
    comboId,
    label,
    pGrid: pFinal,
    pFinal,
    odds: null,
    value: null,
  };
}

test("pickBestCombo returns null only when no candidates", () => {
  assert.equal(pickBestCombo([]), null);
});

test("pickBestCombo always takes max pFinal even below safe tier floor", () => {
  const safeFloor = DEFAULT_COMBO_TIER_MIN_PFINAL.safe;
  assert.ok(safeFloor > 60);

  const evaluated = [
    cand("home_and_over_25", 58),
    cand("btts_and_over_25", 64),
    cand("away_and_btts", 51),
  ];
  // All below safe floor (75)
  assert.ok(evaluated.every((c) => c.pFinal < safeFloor));

  const best = pickBestCombo(evaluated);
  assert.ok(best);
  assert.equal(best!.comboId, "btts_and_over_25");
  assert.equal(best!.pFinal, 64);
  assert.ok(best!.pFinal < safeFloor);
});

test("pickBestCombo prefers higher pFinal when some clear the floor", () => {
  const evaluated = [
    cand("low", 40),
    cand("mid", 70),
    cand("high", 82),
  ];
  const best = pickBestCombo(evaluated);
  assert.equal(best!.comboId, "high");
  assert.equal(best!.pFinal, 82);
});
