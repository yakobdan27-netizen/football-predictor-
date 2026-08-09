import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateFamilySelection,
  conflictGroupOf,
  DEFAULT_SLIP_PREFERENCES,
} from "./types";

describe("conflict groups", () => {
  it("accepts default four from distinct groups", () => {
    const v = validateFamilySelection(DEFAULT_SLIP_PREFERENCES.families);
    assert.equal(v.ok, true);
  });

  it("rejects two G1 families", () => {
    const v = validateFamilySelection([
      "RESULT_1X2",
      "DOUBLE_CHANCE",
      "TOTALS",
      "COMBO",
    ]);
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.equal(v.groupId, "G1");
      assert.ok(v.conflict.includes("RESULT_1X2"));
      assert.ok(v.conflict.includes("DOUBLE_CHANCE"));
    }
  });

  it("rejects HALF_GOALS with DIEH", () => {
    const v = validateFamilySelection([
      "RESULT_1X2",
      "TOTALS",
      "HALF_GOALS",
      "DIEH",
    ]);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.groupId, "G3");
  });

  it("maps families to groups", () => {
    assert.equal(conflictGroupOf("COMBO"), "G4");
    assert.equal(conflictGroupOf("CORNERS"), "G4");
    assert.equal(conflictGroupOf("TEAM_GOALS"), "G2");
  });
});
