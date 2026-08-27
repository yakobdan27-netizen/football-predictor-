import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHandicapSamplesFromBatches,
  empiricalAsianCoverRate,
  handicapEmpiricalProb,
  mergeHandicapSamples,
} from "./handicap-empirical";
import { asianHandicapResult, goalDifference } from "./handicap";
import type { PredictionBatch } from "./types";

const sampleRows = [
  { ftHome: 3, ftAway: 1 },
  { ftHome: 2, ftAway: 1 },
  { ftHome: 1, ftAway: 2 },
  { ftHome: 0, ftAway: 2 },
];

test("empiricalAsianCoverRate matches asianHandicapResult", () => {
  for (const side of ["home", "away"] as const) {
    for (const line of [-1.5, -0.5, 0.5, 1.5]) {
      let covers = 0;
      let decisive = 0;
      for (const row of sampleRows) {
        const diff = goalDifference(row.ftHome, row.ftAway);
        const r = asianHandicapResult(diff, line);
        if (r === "push") continue;
        decisive += 1;
        if (r === side) covers += 1;
      }
      const emp = empiricalAsianCoverRate(sampleRows, line, side);
      assert.equal(emp.n, decisive);
      assert.ok(Math.abs(emp.prob - (decisive ? covers / decisive : 0)) < 1e-9);
    }
  }
});

test("handicapEmpiricalProb marks insufficient below threshold", () => {
  const few = sampleRows.slice(0, 2);
  const r = handicapEmpiricalProb({
    rows: few,
    homeLine: -1.5,
    side: "home",
    minSamples: 15,
  });
  assert.equal(r.source, "insufficient");
  assert.equal(r.n, 2);
});

test("handicapEmpiricalProb marks hist when enough samples", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    ftHome: i % 3 === 0 ? 2 : 1,
    ftAway: 0,
  }));
  const r = handicapEmpiricalProb({
    rows,
    homeLine: -0.5,
    side: "home",
    minSamples: 15,
  });
  assert.equal(r.source, "hist");
  assert.ok(r.n >= 15);
});

test("mergeHandicapSamples dedupes identical rows", () => {
  const a = [{ ftHome: 2, ftAway: 1, date: "2024-01-01" }];
  const b = [{ ftHome: 2, ftAway: 1, date: "2024-01-01" }];
  const merged = mergeHandicapSamples(a, b);
  assert.equal(merged.length, 1);
});

test("buildHandicapSamplesFromBatches collects H2H and venue rows", () => {
  const batches: PredictionBatch[] = [
    {
      id: "b1",
      date: "2024-06-01",
      league: "Premier League",
      batchName: "test",
      createdAt: "",
      batchKind: "manual",
      matches: [
        {
          id: "m1",
          homeTeam: "Arsenal",
          awayTeam: "Chelsea",
          league: "Premier League",
          predictions: {},
          actualResults: {},
          scored: {},
          teamStats: { home: { goals: 2 }, away: { goals: 1 } },
        },
        {
          id: "m2",
          homeTeam: "Arsenal",
          awayTeam: "Liverpool",
          predictions: {},
          actualResults: {},
          scored: {},
          teamStats: { home: { goals: 1 }, away: { goals: 0 } },
        },
        {
          id: "m3",
          homeTeam: "Tottenham",
          awayTeam: "Chelsea",
          predictions: {},
          actualResults: {},
          scored: {},
          teamStats: { home: { goals: 0 }, away: { goals: 2 } },
        },
      ],
    },
  ];

  const rows = buildHandicapSamplesFromBatches(
    "Arsenal",
    "Chelsea",
    "Premier League",
    batches
  );
  assert.ok(rows.length >= 2);
});
