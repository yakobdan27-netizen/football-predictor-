import assert from "node:assert/strict";
import { test } from "node:test";
import { parseApiFootballLineups } from "./parse-fixture-lineups";

test("parseApiFootballLineups maps home/away by team id", () => {
  const rows = [
    {
      team: { id: 42, name: "Arsenal" },
      formation: "4-3-3",
      startXI: [{ player: { name: "Saka" } }, { player: { name: "Rice" } }],
      substitutes: [{ player: { name: "Sub A" } }],
    },
    {
      team: { id: 49, name: "Chelsea" },
      formation: "3-4-3",
      startXI: [{ player: { name: "Palmer" } }],
      substitutes: [],
    },
  ];
  const lu = parseApiFootballLineups(rows, { homeTeamId: 42, awayTeamId: 49 });
  assert.ok(lu);
  assert.equal(lu!.home.formation, "4-3-3");
  assert.equal(lu!.away.formation, "3-4-3");
  assert.equal(lu!.home.starting.length, 2);
  assert.equal(lu!.away.starting[0], "Palmer");
});

test("parseApiFootballLineups returns undefined for empty payload", () => {
  assert.equal(parseApiFootballLineups([]), undefined);
});
