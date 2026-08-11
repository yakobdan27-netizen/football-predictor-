import assert from "node:assert/strict";
import {
  classifyBatchProvenance,
  classifyStoreHint,
  isBlendEligible,
  isSystemGroupProvenance,
} from "./provenance";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

test("manual batch without bulk meta", () => {
  assert.equal(
    classifyBatchProvenance({ batchKind: "manual" }),
    "manual_batch"
  );
});

test("livescore bulk → system_historical", () => {
  assert.equal(
    classifyBatchProvenance({
      batchKind: "manual",
      bulkScrapeMeta: {
        season: "2025/2026",
        source: "livescore-bulk",
        scrapedAt: "2026-01-01",
      },
    }),
    "system_historical"
  );
});

test("recommended → unknown (excluded)", () => {
  const p = classifyBatchProvenance({ batchKind: "recommended" });
  assert.equal(p, "unknown");
  assert.equal(isBlendEligible(p), false);
});

test("hist / seed / learner store hints", () => {
  assert.equal(classifyStoreHint("hist_table"), "api_historical");
  assert.equal(classifyStoreHint("seed_baseline"), "system_historical");
  assert.equal(classifyStoreHint("learner_aggregate"), "ai_learner");
  assert.equal(isSystemGroupProvenance("ai_learner"), true);
});

console.log("provenance tests passed");
