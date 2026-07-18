/**
 * Run: npx tsx scripts/full-system-validation.ts
 */
import assert from "node:assert/strict";
import { allHalfGoalsBaselines } from "../lib/prediction-log/half-goals-baselines";
import { allConcededHalfBaselines } from "../lib/prediction-log/conceded-half-baselines";
import { allCornersBaselines } from "../lib/prediction-log/corners-baselines";
import { deriveBatchLeague, matchLeague } from "../lib/prediction-log/match-league";
import {
  loadClubHalfAttackDefence,
  loadLeagueAfBaselines,
} from "../lib/prediction-log/hsh-half-rates";
import { predictHighestScoringHalf } from "../lib/prediction-log/hsh-model";
import { predictCornersMatch } from "../lib/prediction-log/corners-model";
import type { LogMatch } from "../lib/prediction-log/types";

const LEAGUES = ["Premier League", "La Liga", "Serie A", "Ligue 1"] as const;
const SEASONS = ["2021/22", "2022/23", "2023/24", "2024/25", "2025/26"] as const;

const scoring = allHalfGoalsBaselines();
const conceded = allConcededHalfBaselines();
const corners = allCornersBaselines();

function coverMiss(
  rows: { league: string; season: string }[]
): string[] {
  const miss: string[] = [];
  for (const L of LEAGUES) {
    for (const S of SEASONS) {
      if (!rows.some((r) => r.league === L && r.season === S)) miss.push(`${L}|${S}`);
    }
  }
  return miss;
}

const scoreMiss = coverMiss(scoring);
const concMiss = coverMiss(conceded);
const cornMiss = coverMiss(corners);

console.log("SEED_COUNTS", {
  scoring: scoring.length,
  conceded: conceded.length,
  corners: corners.length,
});
console.log("SEED_COVER_MISS", {
  scoring: scoreMiss.length,
  conceded: concMiss.length,
  corners: cornMiss.length,
});
assert.ok(scoring.length >= 300, "scoring seed too small");
assert.ok(conceded.length >= 300, "conceded seed too small");
assert.ok(corners.length >= 300, "corners seed too small");
assert.equal(scoreMiss.length, 0, `scoring missing seasons: ${scoreMiss.slice(0, 5)}`);
assert.equal(concMiss.length, 0, `conceded missing seasons: ${concMiss.slice(0, 5)}`);
assert.equal(cornMiss.length, 0, `corners missing seasons: ${cornMiss.slice(0, 5)}`);

const matches: LogMatch[] = [
  {
    id: "m-pl",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    league: "Premier League",
    predictions: {},
    actualResults: {},
    scored: {},
  },
  {
    id: "m-ll",
    homeTeam: "Real Madrid",
    awayTeam: "Barcelona",
    league: "La Liga",
    predictions: {},
    actualResults: {},
    scored: {},
  },
  {
    id: "m-sa",
    homeTeam: "Inter",
    awayTeam: "Juventus",
    league: "Serie A",
    predictions: {},
    actualResults: {},
    scored: {},
  },
  {
    id: "m-l1",
    homeTeam: "PSG",
    awayTeam: "Marseille",
    league: "Ligue 1",
    predictions: {},
    actualResults: {},
    scored: {},
  },
];

const batchId = `sys-val-${Date.now()}`;
const batchLeague = deriveBatchLeague(matches);
assert.equal(batchLeague, "Mixed");
assert.equal(matchLeague(matches[1]!, "Premier League"), "La Liga");
console.log("MULTI_LEAGUE_BATCH", {
  batchId,
  batchLeague,
  leagues: matches.map((m) => m.league),
});

const hsh: Array<{
  id: string;
  league: string;
  p1h: number;
  p2h: number;
  pTie: number;
  recommended: string;
  confidence: string;
}> = [];
const cornPreds: Array<{
  id: string;
  expectedTotal: number;
  pOver95: number;
}> = [];

for (const m of matches) {
  const league = m.league!;
  const home = loadClubHalfAttackDefence(m.homeTeam, league, []);
  const away = loadClubHalfAttackDefence(m.awayTeam, league, []);
  const lg = loadLeagueAfBaselines(league);
  const p = predictHighestScoringHalf({
    matchId: m.id,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    league,
    homeRates: home,
    awayRates: away,
    lgAf1: lg.lgAf1,
    lgAf2: lg.lgAf2,
  });
  assert.ok(Math.abs(p.p1h + p.p2h + p.pTie - 1) < 1e-6);
  assert.ok(["1H", "2H", "Tie"].includes(p.recommended));
  assert.ok(["high", "medium", "low"].includes(p.confidence));
  assert.ok(p.detail.lambdaA1 > 0 && p.detail.lambdaB1 > 0);
  hsh.push({
    id: m.id,
    league,
    p1h: p.p1h,
    p2h: p.p2h,
    pTie: p.pTie,
    recommended: p.recommended,
    confidence: p.confidence,
  });

  const c = predictCornersMatch({
    matchId: m.id,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    league,
    batches: [],
  });
  assert.ok(c.expectedTotal > 0);
  assert.ok(Math.abs(c.pOver95 + c.pUnder95 - 1) < 1e-6);
  cornPreds.push({
    id: m.id,
    expectedTotal: c.expectedTotal,
    pOver95: c.pOver95,
  });
}

console.log(
  "HSH_OK",
  hsh.length,
  hsh.map((h) => `${h.league}:${h.recommended}/${h.confidence}`).join(" | ")
);
console.log(
  "CORNERS_OK",
  cornPreds.length,
  cornPreds.map((c) => c.expectedTotal.toFixed(2)).join(",")
);
console.log(
  "ARCHITECTURE_NOTE",
  "JSON seed priors (not SQLite); live match logs = batch teamStats in client KV/local storage"
);
console.log("BATCH_ID", batchId);
console.log("MATCHES_TESTED", matches.length);
console.log("VALIDATION_PASS");
