import assert from "node:assert/strict";
import { buildStagingRows, filterStagingRows } from "./teams-quality-roster";
import { allDemoTeams } from "@/lib/data/demo-teams";
import { emptyTeamsQualityStore, normalizeTeamRecord } from "./teams-quality";

const rosterSize = allDemoTeams().length;
assert.ok(rosterSize >= 130, `expected large roster, got ${rosterSize}`);

const empty = buildStagingRows(null);
assert.equal(empty.length, rosterSize);
assert.equal(empty.filter((r) => r.inStore).length, 0);
assert.equal(empty.every((r) => r.tier === "C"), true);

const store = emptyTeamsQualityStore();
store.teams = [
  normalizeTeamRecord({ team_name: "Arsenal", tier: "A" }, store.tier_config),
];
const withSave = buildStagingRows(store);
const arsenal = withSave.find((r) => r.team_name === "Arsenal");
assert.ok(arsenal);
assert.equal(arsenal.tier, "A");
assert.equal(arsenal.inStore, true);

store.teams.push(
  normalizeTeamRecord({ team_name: "My Custom FC", tier: "D" }, store.tier_config)
);
const withCustom = buildStagingRows(store);
assert.ok(withCustom.some((r) => r.team_name === "My Custom FC" && r.isCustom));

const filtered = filterStagingRows(withSave, "A", "");
assert.ok(filtered.some((r) => r.team_name === "Arsenal"));
assert.ok(!filtered.some((r) => r.team_name === "Barcelona"));

console.log("teams-quality-roster: all passed");
