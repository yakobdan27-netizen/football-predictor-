/**
 * Run: npx tsx lib/prediction-log/half-goals-baselines.test.ts
 */
import assert from "node:assert/strict";
import {
  allHalfGoalsBaselines,
  lookupClubHalfBaseline,
  lookupLeagueHalfBaseline,
  seasonFromDate,
} from "./half-goals-baselines";
import { computeTeamHalfShare, computeLeagueHalfShare } from "./hsh-model";
import { computeTeamHalfAverages, computeLeagueHalfAverages } from "./half-comparison-model";
import type { PredictionBatch } from "./types";

const rows = allHalfGoalsBaselines();
assert.ok(rows.length >= 376, `expected >=376 rows, got ${rows.length}`);

for (const row of rows.slice(0, 50)) {
  const pctSum = row.pct1hGreater + row.pctEqual + row.pct2hGreater;
  assert.ok(Math.abs(pctSum - 100) <= 1, `${row.clubName} ${row.season} pct sum ${pctSum}`);
  assert.ok(
    Math.abs(row.avg1h + row.avg2h - row.avgGoals) <= 0.05,
    `${row.clubName} halves should approx avgGoals`
  );
}

// Alias + season preference / fallback
{
  const city2425 = lookupClubHalfBaseline("Man City", "Premier League", "2024/25");
  assert.ok(city2425);
  assert.equal(city2425!.season, "2024/25");
  assert.equal(city2425!.avg1h, 1.28);

  const cityLatest = lookupClubHalfBaseline("Manchester City", "Premier League");
  assert.ok(cityLatest);
  assert.equal(cityLatest!.season, "2025/26");

  const psg = lookupClubHalfBaseline("PSG", "Ligue 1", "2023/24");
  assert.ok(psg);
  assert.equal(psg!.avgGoals, 2.89);

  const inter = lookupClubHalfBaseline("Inter", "Serie A", "2024/25");
  assert.ok(inter);
  assert.ok(inter!.avg2h > inter!.avg1h);
}

{
  assert.equal(seasonFromDate("2025-09-01"), "2025/26");
  assert.equal(seasonFromDate("2026-03-15"), "2025/26");
  assert.equal(seasonFromDate("2024-07-01"), "2023/24");
}

{
  const league = lookupLeagueHalfBaseline("Premier League", "2024/25");
  assert.ok(league);
  assert.equal(league!.clubCount, 20);
  assert.ok(league!.avg2h > league!.avg1h);
}

function makeMatch(
  homeTeam: string,
  awayTeam: string,
  homeHt: number,
  homeFt: number,
  awayHt: number,
  awayFt: number
) {
  return {
    id: `${homeTeam}-${awayTeam}-${Math.random()}`,
    homeTeam,
    awayTeam,
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: {
      home: { goals: homeFt, firstHalfGoals: homeHt },
      away: { goals: awayFt, firstHalfGoals: awayHt },
    },
  };
}

function makeBatch(date: string, matches: ReturnType<typeof makeMatch>[]): PredictionBatch {
  return {
    id: `batch-${date}-${Math.random()}`,
    date,
    league: "Premier League",
    batchName: "test",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    matches,
  };
}

// Thin sample → baseline
{
  const thin = computeTeamHalfShare([], "Arsenal", "home", {
    league: "Premier League",
    season: "2024/25",
  });
  assert.equal(thin.sample, 0, "live sample stays 0 for confidence");
  assert.ok(thin.baselineSource?.includes("Arsenal"));
  assert.ok(thin.share1h > 0 && thin.share1h < 1);
  assert.equal(thin.gf1h, 1.22);

  const leagueThin = computeLeagueHalfShare([], "Premier League", { season: "2024/25" });
  assert.ok(leagueThin.baselineSource?.includes("Premier League"));
  assert.ok(leagueThin.leagueAvgGoals > 2);

  const hcThin = computeTeamHalfAverages([], "Arsenal", "home", {
    league: "Premier League",
    season: "2024/25",
  });
  assert.equal(hcThin.sample, 0);
  assert.equal(hcThin.hasBaselineAvgs, true);
  assert.equal(hcThin.avg1hScored, 1.22);

  const hcLeague = computeLeagueHalfAverages([], "La Liga", { season: "2024/25" });
  assert.equal(hcLeague.source, "fallback");
  assert.ok(hcLeague.baselineSource);
}

// Rich sample (≥6) → batch stats, not baseline
{
  const matches = Array.from({ length: 6 }, (_, i) =>
    makeMatch("Arsenal", `Opp${i}`, 0, 1, 0, 0)
  );
  const batches = [makeBatch("2025-10-01", matches)];
  const rich = computeTeamHalfShare(batches, "Arsenal", "home", {
    league: "Premier League",
    season: "2024/25",
  });
  assert.equal(rich.sample, 6);
  assert.equal(rich.baselineSource, null);
  // All 0 HT / 1 FT → share1h = 0
  assert.equal(rich.gf1h, 0);
  assert.equal(rich.gf2h, 1);

  const hcRich = computeTeamHalfAverages(batches, "Arsenal", "home", {
    league: "Premier League",
  });
  assert.equal(hcRich.sample, 6);
  assert.equal(hcRich.baselineSource, null);
  assert.equal(hcRich.avg1hScored, 0);
}

console.log("half-goals-baselines tests passed");
