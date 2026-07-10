import assert from "node:assert/strict";
import { emptyTeamsQualityStore, normalizeTeamRecord, setRosterQualityStore } from "./teams-quality";
import { isValidFixture, teamsForLeague } from "./teams";

const store = emptyTeamsQualityStore();
store.teams = [
  normalizeTeamRecord(
    {
      team_name: "Custom United",
      tier: "B",
      leagues: ["Premier League"],
    },
    store.tier_config
  ),
  normalizeTeamRecord(
    {
      team_name: "Orphan FC",
      tier: "C",
    },
    store.tier_config
  ),
];

setRosterQualityStore(store);

const pl = teamsForLeague("Premier League");
assert.ok(pl.includes("Custom United"), "custom with league should be in PL roster");
assert.ok(pl.includes("Arsenal"), "demo teams still present");
assert.ok(!pl.includes("Orphan FC"), "custom without league excluded");

assert.ok(
  isValidFixture("Custom United", "Arsenal", "Premier League"),
  "custom vs demo fixture should be valid"
);
assert.ok(
  !isValidFixture("Orphan FC", "Arsenal", "Premier League"),
  "orphan custom should fail validation"
);

const laLiga = teamsForLeague("La Liga", store);
assert.ok(!laLiga.includes("Custom United"), "custom not listed for other leagues");

setRosterQualityStore(null);
console.log("teams-roster-merge.test.ts: all passed");
