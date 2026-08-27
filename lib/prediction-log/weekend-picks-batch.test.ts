import assert from "node:assert/strict";
import { test } from "node:test";
import type { WeekendOpportunityRow } from "@/lib/match-centre/weekend-opportunities";
import {
  buildWeekendPicksBatchFromRows,
  sortDedupeWeekendRows,
} from "./weekend-picks-batch";

function row(
  id: number,
  kickoffIso: string,
  league = "Premier League"
): WeekendOpportunityRow {
  return {
    apiFixtureId: id,
    league,
    kickoffIso,
    matchLabel: `Home ${id} vs Away ${id}`,
    homeTeam: `Home ${id}`,
    awayTeam: `Away ${id}`,
    marketLabel: "Draw Either Half",
    prediction: "Yes",
    probabilityPct: 65,
    pRaw: 0.65,
    pCalibrated: 0.65,
    rank: 1,
    msamGatePassed: true,
    trace: {
      fixtureSource: "match_centre_upcoming",
      pRaw: 0.65,
      pCalibrated: 0.65,
      nEffective: 10,
      coherenceOk: true,
    },
  };
}

test("buildWeekendPicksBatchFromRows returns null for empty rows", () => {
  assert.equal(buildWeekendPicksBatchFromRows([]), null);
});

test("sortDedupeWeekendRows dedupes and sorts by kickoff", () => {
  const out = sortDedupeWeekendRows([
    row(2, "2026-08-30T15:00:00.000Z"),
    row(1, "2026-08-28T15:00:00.000Z"),
    row(1, "2026-08-28T15:00:00.000Z"),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.apiFixtureId, 1);
  assert.equal(out[1]!.apiFixtureId, 2);
});

test("buildWeekendPicksBatchFromRows builds batch with correct metadata", () => {
  const batch = buildWeekendPicksBatchFromRows(
    [
      row(1, "2026-08-28T15:00:00.000Z", "Premier League"),
      row(2, "2026-08-29T15:00:00.000Z", "La Liga"),
    ],
    { batchId: "WEEKEND-2026-08-28" }
  );
  assert.ok(batch);
  assert.equal(batch!.id, "WEEKEND-2026-08-28");
  assert.equal(batch!.batchName, "Weekend Picks (API)");
  assert.equal(batch!.matches.length, 2);
  assert.equal(batch!.matches[0]!.homeTeam, "Home 1");
  assert.equal(batch!.matches[0]!.apiFixtureId, 1);
  assert.equal(batch!.matches[1]!.league, "La Liga");
});
