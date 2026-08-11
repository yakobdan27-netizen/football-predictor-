import assert from "node:assert/strict";
import { isMissingStat, preserveNullableStat } from "./stats";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

test("NULL ≠ 0 — preserve null", () => {
  assert.equal(preserveNullableStat(null), null);
  assert.equal(preserveNullableStat(undefined), null);
  assert.equal(preserveNullableStat(0), 0);
  assert.equal(preserveNullableStat(5), 5);
  assert.equal(isMissingStat(null), true);
  assert.equal(isMissingStat(0), false);
});

console.log("stats tests passed");
