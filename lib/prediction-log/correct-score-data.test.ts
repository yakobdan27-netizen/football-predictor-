import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clubSampleSize,
  correctScoreHasEnoughData,
  CORRECT_SCORE_MIN_SAMPLE,
} from "./correct-score-data";
import { scoreGridForMatch } from "./correct-score-freeze";
import { createClubRecord, type ClubRecord } from "./club-record-types";
import type { LogMatch } from "./types";

function withSample(record: ClubRecord, n: number): ClubRecord {
  return {
    ...record,
    capacity: { ...record.capacity, sampleSize: n, lowSample: n < 5 },
    statMetadata: {
      attack_strength_home: 1,
      attack_strength_away: 1,
      defense_strength_home: 1,
      defense_strength_away: 1,
      goals_for_rolling: 1.2,
      goals_against_rolling: 1.1,
      xg_for: 1.2,
      xg_against: 1.1,
      form_points: 5,
      tier: null,
      sample_size: n,
      lastUpdated: new Date().toISOString(),
    },
  };
}

test("clubSampleSize prefers capacity then metadata", () => {
  const base = createClubRecord("a", "Arsenal", "Premier League");
  assert.equal(clubSampleSize(null), 0);
  assert.equal(clubSampleSize(base), 0);
  assert.equal(clubSampleSize(withSample(base, 7)), 7);
});

test("correctScoreHasEnoughData requires both clubs at threshold", () => {
  const home = withSample(createClubRecord("h", "Home", "Premier League"), CORRECT_SCORE_MIN_SAMPLE);
  const awayThin = withSample(createClubRecord("a", "Away", "Premier League"), 2);
  const awayOk = withSample(createClubRecord("a2", "Away2", "Premier League"), CORRECT_SCORE_MIN_SAMPLE);
  assert.equal(correctScoreHasEnoughData(home, awayThin), false);
  assert.equal(correctScoreHasEnoughData(home, awayOk), true);
  assert.equal(correctScoreHasEnoughData(null, awayOk), false);
});

test("scoreGridForMatch uses seed priors when sample is insufficient", () => {
  const home = withSample(createClubRecord("h", "Arsenal", "Premier League"), 0);
  const away = withSample(createClubRecord("a", "Chelsea", "Premier League"), 0);
  const match: LogMatch = {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    homeClubId: "h",
    awayClubId: "a",
    predictions: {},
    actualResults: {},
    scored: {},
  };
  const grid = scoreGridForMatch(
    match,
    "Premier League",
    { h: home, a: away },
    null,
    []
  );
  assert.ok(grid);
  assert.ok(grid!.length > 0);
  assert.ok(grid![0]!.length > 0);
});

test("scoreGridForMatch returns null when clubs have no sample and no seed", () => {
  const home = withSample(createClubRecord("h", "ZZ Unknown FC", "Premier League"), 0);
  const away = withSample(createClubRecord("a", "YY Mystery United", "Premier League"), 0);
  const match: LogMatch = {
    id: "m1",
    homeTeam: "ZZ Unknown FC",
    awayTeam: "YY Mystery United",
    homeClubId: "h",
    awayClubId: "a",
    predictions: {},
    actualResults: {},
    scored: {},
  };
  const grid = scoreGridForMatch(
    match,
    "Premier League",
    { h: home, a: away },
    null,
    []
  );
  assert.equal(grid, null);
});

test("scoreGridForMatch builds a grid when both clubs have enough sample", () => {
  const home = withSample(createClubRecord("h", "Arsenal", "Premier League"), 8);
  const away = withSample(createClubRecord("a", "Chelsea", "Premier League"), 8);
  const match: LogMatch = {
    id: "m1",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    homeClubId: "h",
    awayClubId: "a",
    predictions: {},
    actualResults: {},
    scored: {},
  };
  const grid = scoreGridForMatch(
    match,
    "Premier League",
    { h: home, a: away },
    null,
    []
  );
  assert.ok(grid);
  assert.ok(grid!.length > 0);
  assert.ok(grid![0]!.length > 0);
});
