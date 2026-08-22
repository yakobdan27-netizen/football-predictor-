import assert from "node:assert/strict";
import {
  classifyBatchProvenance,
  classifyStoreHint,
  isBlendEligible,
  isSystemGroupProvenance,
} from "./provenance";
import { systemGroupFromSeasonCorpus } from "./source-groups";

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
  assert.equal(isSystemGroupProvenance("system_season_corpus"), true);
});

test("system season corpus group", () => {
  const g = systemGroupFromSeasonCorpus({
    matchCount: 120,
    dateFrom: "2026-08-15",
    dateTo: "2026-12-20",
  });
  assert.equal(g.recordCount, 120);
  assert.equal(g.byProvenance.system_season_corpus, 120);
});

console.log("provenance tests passed");
