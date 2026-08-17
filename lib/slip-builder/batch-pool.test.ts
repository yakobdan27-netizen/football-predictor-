import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBatchFixturePool, windowForPredictionBatch } from "./batch-pool";
import { DEFAULT_SLIP_PREFERENCES } from "./types";
import type { PredictionBatch } from "@/lib/prediction-log/types";

function stubBatch(
  id: string,
  date: string,
  matches: PredictionBatch["matches"]
): PredictionBatch {
  return {
    id,
    batchName: id,
    date,
    createdAt: date,
    league: "Premier League",
    matches,
    batchKind: "manual",
  };
}

describe("loadBatchFixturePool sourceBatchId", () => {
  const batchA = stubBatch("batch-a", "2026-08-10", [
    {
      id: "m1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      matchDate: "2026-08-10",
      apiFixtureId: 101,
      predictions: {},
      actualResults: {},
      scored: {},
    },
    {
      id: "m2",
      homeTeam: "Liverpool",
      awayTeam: "City",
      matchDate: "2026-08-12",
      apiFixtureId: 102,
      predictions: {},
      actualResults: {},
      scored: {},
    },
  ]);
  const batchB = stubBatch("batch-b", "2026-08-11", [
    {
      id: "m3",
      homeTeam: "Spurs",
      awayTeam: "United",
      matchDate: "2026-08-11",
      apiFixtureId: 201,
      predictions: {},
      actualResults: {},
      scored: {},
    },
  ]);

  it("scopes pool to one batch when sourceBatchId is set", async () => {
    const pool = await loadBatchFixturePool([batchA, batchB], {
      ...DEFAULT_SLIP_PREFERENCES,
      sourceBatchId: "batch-a",
    });
    assert.equal(pool.length, 2);
    assert.ok(pool.every((p) => p.sourceBatchId === "batch-a"));
    assert.ok(pool.some((p) => p.fixtureId === "api:101"));
    assert.ok(!pool.some((p) => p.fixtureId === "api:201"));
  });

  it("windowForPredictionBatch spans batch match dates", () => {
    const w = windowForPredictionBatch(batchA);
    assert.equal(w.start, "2026-08-10");
    assert.equal(w.end, "2026-08-12");
  });
});
