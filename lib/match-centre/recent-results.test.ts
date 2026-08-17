import assert from "node:assert/strict";
import { test } from "node:test";

/** Pure copy of half-goals logic for unit testing without DB. */
function halfGoalsFromEvents(
  events: Array<{ minute: number | null; type: string | null; team: string | null }>,
  home: string,
  away: string
): { homeGoals1h: number | null; awayGoals1h: number | null } {
  const goals = events.filter((e) => {
    const t = (e.type ?? "").toLowerCase();
    return t.includes("goal") && !t.includes("missed");
  });
  if (!goals.length) return { homeGoals1h: null, awayGoals1h: null };

  let homeGoals1h = 0;
  let awayGoals1h = 0;
  let saw1h = false;
  for (const g of goals) {
    const minute = g.minute ?? 99;
    if (minute > 45) continue;
    saw1h = true;
    const team = (g.team ?? "").trim();
    if (team === home) homeGoals1h += 1;
    else if (team === away) awayGoals1h += 1;
  }
  if (!saw1h) return { homeGoals1h: null, awayGoals1h: null };
  return { homeGoals1h, awayGoals1h };
}

test("halfGoalsFromEvents counts first-half goals only", () => {
  const events = [
    { minute: 12, type: "Goal", team: "Arsenal", player: null },
    { minute: 44, type: "Goal", team: "Chelsea", player: null },
    { minute: 67, type: "Goal", team: "Arsenal", player: null },
  ];
  const ht = halfGoalsFromEvents(events, "Arsenal", "Chelsea");
  assert.equal(ht.homeGoals1h, 1);
  assert.equal(ht.awayGoals1h, 1);
});

test("halfGoalsFromEvents returns null when no first-half goals", () => {
  const events = [
    { minute: 55, type: "Goal", team: "Arsenal", player: null },
  ];
  const ht = halfGoalsFromEvents(events, "Arsenal", "Chelsea");
  assert.equal(ht.homeGoals1h, null);
  assert.equal(ht.awayGoals1h, null);
});
