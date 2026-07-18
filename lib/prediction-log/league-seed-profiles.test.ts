import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAllSeedLeagueProfiles,
  buildSeedCharacterProfile,
  mergeSeedIntoLeagueProfiles,
} from "./league-seed-profiles";
import { emptyLeagueProfilesStore, recomputeLeagueProfiles } from "./league-profiles";
import { getLeagueMatchupAnalysis } from "./league-matchup-analysis";
import {
  AI_ENHANCED_MIN_SAMPLES,
  getEnhancedMatchupPrediction,
} from "./ai-enhanced-prediction";
import { emptyLearnerStats } from "./ai-learner";
import { leagueProfileKey } from "./season";

test("seed profiles cover PL seasons 2021/22–2025/26", () => {
  const all = buildAllSeedLeagueProfiles();
  for (const season of ["2021/22", "2022/23", "2023/24", "2024/25", "2025/26"]) {
    const key = leagueProfileKey("premier_league", season);
    assert.ok(all[key], `missing ${key}`);
    assert.equal(all[key]!.dataSource, "seed");
    assert.ok(all[key]!.characterProfile.goals_per_match_avg.value != null);
  }
});

test("buildSeedCharacterProfile returns half and goals traits", () => {
  const built = buildSeedCharacterProfile("Premier League", "2024/25");
  assert.ok(built);
  assert.ok((built!.profile.first_half_goals_avg.value ?? 0) > 0);
  assert.ok((built!.profile.second_half_goals_avg.value ?? 0) > 0);
  assert.ok((built!.profile.goals_per_match_avg.value ?? 0) > 0);
});

test("recomputeLeagueProfiles includes seed cold-start with no batches", () => {
  const store = recomputeLeagueProfiles([], emptyLeagueProfilesStore());
  const key = leagueProfileKey("premier_league", "2025/26");
  assert.ok(store.leagues[key]);
  assert.ok(
    store.leagues[key]!.dataSource === "seed" || store.leagues[key]!.dataSource === "blended"
  );
});

test("mergeSeedIntoLeagueProfiles preserves empty live store seeds", () => {
  const merged = mergeSeedIntoLeagueProfiles(emptyLeagueProfilesStore());
  assert.ok(Object.keys(merged.leagues).length >= 20);
});

test("reference matchup City vs Everton is not empty", () => {
  const analysis = getLeagueMatchupAnalysis(
    "Manchester City",
    "Everton",
    "Premier League"
  );
  assert.ok(analysis);
  assert.equal(analysis!.mode, "reference");
  assert.ok(analysis!.lambdaHome > analysis!.lambdaAway);
  assert.ok(analysis!.mostLikelyScore.includes("-"));
});

test("enhanced prediction stays reference below sample threshold", () => {
  const stats = emptyLearnerStats();
  stats.totalScoredPicks = AI_ENHANCED_MIN_SAMPLES - 1;
  const pred = getEnhancedMatchupPrediction(
    "Manchester City",
    "Everton",
    "Premier League",
    stats
  );
  assert.ok(pred);
  assert.equal(pred!.mode, "reference");
});

test("enhanced prediction switches mode at sample threshold", () => {
  const stats = emptyLearnerStats();
  stats.totalScoredPicks = AI_ENHANCED_MIN_SAMPLES;
  stats.topReliableRanges = ["1.51-2.00"];
  const pred = getEnhancedMatchupPrediction(
    "Manchester City",
    "Everton",
    "Premier League",
    stats
  );
  assert.ok(pred);
  assert.equal(pred!.mode, "ai_enhanced");
  assert.ok(pred!.corrections);
});
