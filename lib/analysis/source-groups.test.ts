import assert from "node:assert/strict";
import {
  countValidSystemMatchRecords,
  partitionBatchesForSystemGroup,
} from "./source-groups";
import type { PredictionBatch } from "@/lib/prediction-log/types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`fail - ${name}`);
    throw e;
  }
}

function batch(
  partial: Partial<PredictionBatch> & Pick<PredictionBatch, "id">
): PredictionBatch {
  return {
    date: "2026-01-01",
    league: "Premier League",
    batchName: "t",
    createdAt: "2026-01-01T00:00:00Z",
    matches: [],
    ...partial,
  };
}

test("partition excludes recommended; dedupes ids", () => {
  const batches = [
    batch({ id: "a", batchKind: "manual" }),
    batch({ id: "a", batchKind: "manual" }),
    batch({ id: "b", batchKind: "recommended" }),
    batch({
      id: "c",
      batchKind: "manual",
      bulkScrapeMeta: {
        season: "2025/2026",
        source: "livescore-bulk",
        scrapedAt: "x",
      },
    }),
  ];
  const { system, unknown } = partitionBatchesForSystemGroup(batches);
  assert.equal(system.length, 2);
  assert.equal(unknown.length, 1);
  assert.equal(system.find((s) => s.id === "c")?.provenance, "system_historical");
});

test("countValidSystemMatchRecords only filled matches", () => {
  const batches = [
    batch({
      id: "m1",
      batchKind: "manual",
      matches: [
        {
          id: "1",
          homeTeam: "A",
          awayTeam: "B",
          resultFilled: true,
          matchDate: "2026-01-02",
          predictions: {},
          actualResults: {},
          scored: {},
        } as PredictionBatch["matches"][number],
        {
          id: "2",
          homeTeam: "C",
          awayTeam: "D",
          resultFilled: false,
          predictions: {},
          actualResults: {},
          scored: {},
        } as PredictionBatch["matches"][number],
      ],
    }),
  ];
  const r = countValidSystemMatchRecords(batches);
  assert.equal(r.count, 1);
  assert.equal(r.dateRange.from, "2026-01-02");
});

console.log("source-groups tests passed");
