import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFormationReference } from "./formation-reference";
import type { ClubIndex, ClubRecord } from "@/lib/prediction-log/club-record-types";
import type { LogMatch } from "@/lib/prediction-log/types";

const clubIndex: ClubIndex = {
  schemaVersion: 1,
  updatedAt: "2026-01-01",
  clubs: [
    {
      clubId: "arsenal_pl",
      clubName: "Arsenal",
      league: "Premier League",
      normalizedName: "arsenal",
    },
    {
      clubId: "chelsea_pl",
      clubName: "Chelsea",
      league: "Premier League",
      normalizedName: "chelsea",
    },
  ],
};

const arsenalRecord: ClubRecord = {
  clubId: "arsenal_pl",
  clubName: "Arsenal",
  league: "Premier League",
  createdAt: "2026-01-01",
  lastUpdated: "2026-01-01",
  histories: {} as ClubRecord["histories"],
  capacity: {} as ClubRecord["capacity"],
  recentLineups: [
    { date: "2026-07-01", formation: "4-3-3", starting: ["A", "B"], opponentId: "x" },
    { date: "2026-07-08", formation: "4-3-3", starting: ["A", "C"], opponentId: "y" },
  ],
};

const match: LogMatch = {
  id: "m1",
  homeTeam: "Arsenal",
  awayTeam: "Chelsea",
  league: "Premier League",
  apiFixtureId: 999,
  homeApiTeamId: 42,
  awayApiTeamId: 49,
  predictions: {},
  actualResults: {},
  scored: {},
};

test("buildFormationReference combines API announced and history typical", () => {
  const ref = buildFormationReference(match, "Mixed", {
    apiLineups: {
      home: { formation: "4-2-3-1", starting: ["Saka"], substitutes: [] },
      away: { formation: "3-4-3", starting: ["Palmer"], substitutes: [] },
    },
    clubIndex,
    clubRecords: { arsenal_pl: arsenalRecord },
  });
  assert.equal(ref.home.announced, "4-2-3-1");
  assert.equal(ref.home.typical, "4-3-3");
  assert.equal(ref.source, "mixed");
  assert.ok(ref.referenceNote.includes("Reference only"));
});
