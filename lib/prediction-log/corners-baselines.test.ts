/**
 * Run: npx tsx lib/prediction-log/corners-baselines.test.ts
 */
import assert from "node:assert/strict";
import {
  allCornersBaselines,
  cornersSeedConfidence,
  lookupClubCornersBaseline,
  lookupClubCornersRecencyBlend,
  lookupLeagueCornersBaseline,
} from "./corners-baselines";

const rows = allCornersBaselines();
assert.ok(rows.length >= 380, `expected >=380 seed rows, got ${rows.length}`);

{
  const city = lookupClubCornersBaseline("Man City", "Premier League", "2024/25");
  assert.ok(city);
  assert.equal(city!.avgCornersWon, 7.7);
  assert.equal(city!.avgCornersConceded, 3.2);

  const psg = lookupClubCornersBaseline("PSG", "Ligue 1", "2025/26");
  assert.ok(psg);
  assert.ok(psg!.avgCornersWon >= 6.5);
}

{
  const blend = lookupClubCornersRecencyBlend("Manchester City", "Premier League");
  assert.ok(blend);
  assert.ok(blend!.seasonCount >= 3);
  assert.ok(blend!.avgCornersWon > 7);
  assert.ok(blend!.cornerDiff > 0);
  assert.ok(blend!.sourceLabel.includes("seed"));
}

{
  const lg = lookupLeagueCornersBaseline("Premier League");
  assert.ok(lg);
  assert.ok(lg!.leagueBase > 4 && lg!.leagueBase < 7);
}

{
  const city = lookupClubCornersRecencyBlend("Manchester City", "Premier League")!;
  // Multi-season stable Club → high with any live count
  assert.equal(cornersSeedConfidence(city, 5), "high");
  assert.equal(cornersSeedConfidence(city, 0), "high");

  assert.equal(cornersSeedConfidence(null, 0), "low");

  const thin = {
    ...city,
    seasonCount: 1,
    cornerDiffStdev: 0,
  };
  assert.equal(cornersSeedConfidence(thin, 0), "low", "single seed season + no live → low");
  assert.equal(cornersSeedConfidence(thin, 3), "low", "seasonCount < 2 → low");

  const unstable = {
    ...city,
    seasonCount: 4,
    cornerDiffStdev: 1.5,
  };
  assert.equal(cornersSeedConfidence(unstable, 0), "medium");
}

console.log("corners-baselines tests passed");
