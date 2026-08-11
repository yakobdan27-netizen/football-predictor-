import assert from "node:assert/strict";
import { aliasesEqual, normalizeAlias } from "./alias";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

test("normalizeAlias lowercases and strips punctuation", () => {
  assert.equal(normalizeAlias("Man United"), "man united");
  assert.equal(normalizeAlias("  FC  Bayern  "), "fc bayern");
  assert.equal(normalizeAlias("Saint-Étienne"), "saint etienne");
});

test("aliasesEqual ignores case and spacing", () => {
  assert.equal(aliasesEqual("Man City", "man  city"), true);
  assert.equal(aliasesEqual("Arsenal", "Chelsea"), false);
});

console.log("alias tests passed");
