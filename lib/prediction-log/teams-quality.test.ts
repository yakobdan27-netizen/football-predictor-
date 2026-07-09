import assert from "node:assert/strict";
import { computeBatchRisk } from "./dynamic-batch-risk";
import {
  applyTierBoostToPFinal,
  emptyTeamsQualityStore,
  mergeImportedTeams,
  normalizeTeamRecord,
  parseTeamsImport,
  tierBoostPercent,
} from "./teams-quality";
import type { TeamsQualityStore } from "./teams-quality-types";

function storeWithTeams(
  rows: Array<{ name: string; tier: "A" | "B" | "C" | "D" }>
): TeamsQualityStore {
  const store = emptyTeamsQualityStore();
  store.teams = rows.map((row) =>
    normalizeTeamRecord({ team_name: row.name, tier: row.tier }, store.tier_config)
  );
  return store;
}

// tierBoostPercent
assert.equal(tierBoostPercent(4, 1), 15);
assert.equal(tierBoostPercent(3, 2), 5);
assert.equal(tierBoostPercent(2, 2), 0);

// applyTierBoostToPFinal — Arsenal (A) vs Luton (D), home win
const plStore = storeWithTeams([
  { name: "Arsenal", tier: "A" },
  { name: "Luton Town", tier: "D" },
]);
const arsenalHome = applyTierBoostToPFinal(
  67,
  "Arsenal",
  "Luton Town",
  "1x2",
  "home",
  plStore
);
assert.equal(arsenalHome.tierBoostPct, 15);
assert.equal(arsenalHome.appliedBoost, 15);
assert.equal(arsenalHome.pFinalWithTier, 82);

// underdog pick reduces probability
const lutonAway = applyTierBoostToPFinal(
  67,
  "Arsenal",
  "Luton Town",
  "1x2",
  "away",
  plStore
);
assert.equal(lutonAway.appliedBoost, -15);
assert.equal(lutonAway.pFinalWithTier, 52);

// Brighton (B) vs Wolves (C)
const bcStore = storeWithTeams([
  { name: "Brighton", tier: "B" },
  { name: "Wolves", tier: "C" },
]);
const brightonHome = applyTierBoostToPFinal(
  58,
  "Brighton",
  "Wolves",
  "1x2",
  "home",
  bcStore
);
assert.equal(brightonHome.tierBoostPct, 5);
assert.equal(brightonHome.pFinalWithTier, 63);

// clamp at 95
const heavyFav = applyTierBoostToPFinal(90, "Arsenal", "Luton Town", "1x2", "home", plStore);
assert.equal(heavyFav.pFinalWithTier, 95);

// import parser
const parsed = parseTeamsImport("Arsenal,A\nBrighton,B\n");
assert.equal(parsed.length, 2);
assert.equal(parsed[0]?.team_name, "Arsenal");

const merged = mergeImportedTeams(emptyTeamsQualityStore(), parsed);
assert.equal(merged.teams.length, 2);

// computeBatchRisk overlay
const risk = computeBatchRisk(
  [
    {
      matchId: "m1",
      homeTeam: "Arsenal",
      awayTeam: "Luton Town",
      marketKey: "1x2",
      odds: 1.2,
      pSignal: 70,
      prediction: "home",
    },
  ],
  { batches: [], analysis: null, teamsQuality: plStore }
);
assert.equal(risk.pFinalBaseByMatch.m1 != null, true);
assert.ok((risk.tierBoostByMatch.m1 ?? 0) > 0);
assert.ok((risk.pFinalByMatch.m1 ?? 0) > (risk.pFinalBaseByMatch.m1 ?? 0));

console.log("teams-quality.test.ts: all passed");
