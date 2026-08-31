import assert from "node:assert/strict";
import { test } from "node:test";
import type { PredictionBatch } from "./types";
import {
  buildWeekendPickLookup,
  extractWeekendMarketFamilyRows,
  selectionKey,
  toWinLoss,
} from "./weekend-market-results";

function basePoolBatch(): PredictionBatch {
  return {
    id: "WEEKEND-2026-08-30",
    date: "2026-08-30",
    league: "Premier League",
    batchName: "Weekend Pool",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    matches: [
      {
        id: "m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        league: "Premier League",
        matchDate: "2026-08-30",
        apiFixtureId: 101,
        predictions: {},
        actualResults: {},
        scored: {},
        teamStats: {
          home: {
            goals: 2,
            firstHalfGoals: 1,
            corners: 6,
            totalShots: 14,
            shotsOnTarget: 5,
          },
          away: {
            goals: 1,
            firstHalfGoals: 0,
            corners: 3,
            totalShots: 8,
            shotsOnTarget: 2,
          },
        },
        resultFilled: true,
      },
    ],
  };
}

test("toWinLoss maps correct/wrong to win/loss", () => {
  assert.equal(toWinLoss("correct"), "win");
  assert.equal(toWinLoss("wrong"), "loss");
  assert.equal(toWinLoss("void"), null);
  assert.equal(toWinLoss("push"), null);
});

test("extractWeekendMarketFamilyRows grades all families for FT+HT fixture", () => {
  const batch = basePoolBatch();
  const rows = extractWeekendMarketFamilyRows(batch, batch.matches[0]!, new Set());
  assert.ok(rows);

  assert.ok(rows!.win.length > 0);
  assert.ok(rows!.halfGoal.length > 0);
  assert.ok(rows!.corner.length > 0);
  assert.ok(rows!.combo.length > 0);
  assert.ok(rows!.bttsHalves.length > 0);
  assert.ok(rows!.drawHalf.length > 0);
  assert.ok(rows!.totalGoals.length > 0);

  const homeWin = rows!.win.find((r) => r.selection === selectionKey("1x2", "home"));
  assert.ok(homeWin);
  assert.equal(homeWin!.result, "win");

  const cornersOver = rows!.corner.find(
    (r) => r.selection === selectionKey("corners_ou", "over") && r.line === 9.5
  );
  assert.ok(cornersOver);
  assert.equal(cornersOver!.result, "loss");
  assert.equal(cornersOver!.actualValue, "9");

  const bttsYes = rows!.bttsHalves.find(
    (r) => r.selection === selectionKey("btts", "yes")
  );
  assert.ok(bttsYes);
  assert.equal(bttsYes!.result, "win");

  const gbhYes = rows!.bttsHalves.find(
    (r) => r.selection === selectionKey("goal_both_halves", "yes")
  );
  assert.ok(gbhYes);
  assert.equal(gbhYes!.result, "win");

  const match2hOver = rows!.totalGoals.find(
    (r) => r.selection === selectionKey("match_2h_total", "over") && r.line === 0.5
  );
  assert.ok(match2hOver);
  assert.equal(match2hOver!.result, "win");
});

test("extractWeekendMarketFamilyRows skips HT-dependent legs without HT", () => {
  const batch = basePoolBatch();
  const match = {
    ...batch.matches[0]!,
    teamStats: {
      home: { goals: 2, corners: 5 },
      away: { goals: 1, corners: 4 },
    },
  };
  const rows = extractWeekendMarketFamilyRows(batch, match, new Set());
  assert.ok(rows);
  assert.ok(rows!.win.some((r) => r.selection === selectionKey("1x2", "home")));
  assert.equal(rows!.halfGoal.length, 0);
  assert.equal(rows!.drawHalf.length, 0);
  assert.ok(rows!.bttsHalves.length > 0);
  assert.equal(
    rows!.bttsHalves.find((r) => r.selection.startsWith("goal_both_halves:")),
    undefined
  );
});

test("extractWeekendMarketFamilyRows returns null without FT goals", () => {
  const batch = basePoolBatch();
  const match = {
    ...batch.matches[0]!,
    teamStats: { home: {}, away: {} },
  };
  assert.equal(extractWeekendMarketFamilyRows(batch, match, new Set()), null);
});

test("extractWeekendMarketFamilyRows ignores non-base batches", () => {
  const batch = {
    ...basePoolBatch(),
    id: "WEEKEND-CORNERS-2026-08-30",
  };
  assert.equal(
    extractWeekendMarketFamilyRows(batch, batch.matches[0]!, new Set()),
    null
  );
});

test("buildWeekendPickLookup flags portfolio and best-pick legs", () => {
  const batches: PredictionBatch[] = [
    basePoolBatch(),
    {
      id: "WEEKEND-BEST-PICK-2026-08-30",
      date: "2026-08-30",
      league: "Premier League",
      batchName: "Best Pick",
      createdAt: new Date().toISOString(),
      batchKind: "manual",
      matches: [
        {
          id: "WEEKEND-BEST-PICK-2026-08-30-m1",
          homeTeam: "Arsenal",
          awayTeam: "Chelsea",
          apiFixtureId: 101,
          predictions: {
            corners_ou: { prediction: "over", line: 9.5, confidence: 60 },
          },
          actualResults: {},
          scored: {},
        },
      ],
    },
  ];
  const lookup = buildWeekendPickLookup(batches, "2026-08-30");
  assert.ok(lookup.has(`101|${selectionKey("corners_ou", "over")}|9.5`));

  const batch = basePoolBatch();
  const rows = extractWeekendMarketFamilyRows(batch, batch.matches[0]!, lookup);
  const picked = rows!.corner.find(
    (r) => r.selection === selectionKey("corners_ou", "over") && r.line === 9.5
  );
  assert.ok(picked);
  assert.equal(picked!.wasWeekendPick, 1);

  const notPicked = rows!.corner.find(
    (r) => r.selection === selectionKey("corners_ou", "under") && r.line === 9.5
  );
  assert.ok(notPicked);
  assert.equal(notPicked!.wasWeekendPick, 0);
});

test("extractWeekendMarketFamilyRows is deterministic for same input", () => {
  const batch = basePoolBatch();
  const a = extractWeekendMarketFamilyRows(batch, batch.matches[0]!, new Set());
  const b = extractWeekendMarketFamilyRows(batch, batch.matches[0]!, new Set());
  assert.deepEqual(a, b);
});
