import assert from "node:assert/strict";

/**
 * Mapping uniqueness contract for core_legacy_record_map keys.
 */
function legacyMapKey(table: string, pk: string): string {
  return `${table}::${pk}`;
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

test("legacy map keys are unique per table+pk", () => {
  const set = new Set<string>();
  const rows = [
    ["hist_fixtures", "1"],
    ["hist_fixtures", "2"],
    ["hist_fixtures", "1"],
  ] as const;
  let dupes = 0;
  for (const [t, pk] of rows) {
    const k = legacyMapKey(t, pk);
    if (set.has(k)) dupes++;
    else set.add(k);
  }
  assert.equal(dupes, 1);
  assert.equal(set.size, 2);
});

console.log("mapping tests passed");
