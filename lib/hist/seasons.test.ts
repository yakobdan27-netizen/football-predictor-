/**
 * Run: npx tsx lib/hist/seasons.test.ts
 */
import assert from "node:assert/strict";
import {
  HIST_COMPLETED_SEASON_COUNT,
  HIST_SEASON_DECAY_BASE,
  HIST_LEAGUES,
  HIST_DOMESTIC_LEAGUES,
  histSeasonWeight,
  histSeasonYears,
  histJobKeys,
  histWindowMinSeason,
  histCompType,
  currentHistSeason,
} from "./seasons";

assert.equal(HIST_COMPLETED_SEASON_COUNT, 11);
assert.equal(HIST_SEASON_DECAY_BASE, 0.8);
assert.equal(HIST_LEAGUES.length, 8);
assert.equal(HIST_DOMESTIC_LEAGUES.length, 5);
assert.ok(HIST_LEAGUES.some((l) => l.id === 2 && l.type === "cup"));
assert.ok(HIST_LEAGUES.some((l) => l.id === 3 && l.type === "cup"));
assert.ok(HIST_LEAGUES.some((l) => l.id === 848 && l.type === "cup"));
assert.ok(HIST_LEAGUES.some((l) => l.id === 61 && l.type === "league"));
assert.equal(histCompType(2), "cup");
assert.equal(histCompType(39), "league");

const today = new Date("2026-08-04T12:00:00.000Z");
const completed = histSeasonYears({ today, includeCurrent: false });
assert.deepEqual(completed, [
  2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025,
]);
assert.equal(completed.length, 11);

const withCurrent = histSeasonYears({ today, includeCurrent: true });
assert.equal(withCurrent.length, 12);
assert.equal(withCurrent[withCurrent.length - 1], currentHistSeason(today));

assert.equal(histWindowMinSeason(today), 2015);
assert.equal(histSeasonWeight(2026, 2026), 1);
assert.ok(Math.abs(histSeasonWeight(2025, 2026) - 0.8) < 1e-9);
assert.ok(Math.abs(histSeasonWeight(2015, 2026) - Math.pow(0.8, 11)) < 1e-9);

const keys = histJobKeys({ today });
assert.equal(keys.length, 8 * 12); // 11 completed + current
assert.equal(keys.filter((k) => k.compType === "cup").length, 36);

console.log("hist seasons tests passed");
