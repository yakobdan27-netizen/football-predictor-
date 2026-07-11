import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLineupContextSignal } from "./lineup-context";
import { createClubRecord, type ClubRecord } from "./club-record-types";

function withLineups(record: ClubRecord, snaps: NonNullable<ClubRecord["recentLineups"]>): ClubRecord {
  return { ...record, recentLineups: snaps };
}

test("lineup context reliability is 0 without enough snapshots", () => {
  const home = createClubRecord("h", "Home", "EPL");
  const away = createClubRecord("a", "Away", "EPL");
  const sig = computeLineupContextSignal(home, away);
  assert.equal(sig.reliability, 0);
  assert.equal(sig.value, 0.5);
});

test("lineup context rewards stable XI and formation", () => {
  const xi = [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K",
  ];
  const home = withLineups(createClubRecord("h", "Home", "EPL"), [
    { date: "2026-01-01", formation: "4-3-3", starting: xi, opponentId: "x" },
    { date: "2026-01-08", formation: "4-3-3", starting: xi, opponentId: "y" },
  ]);
  const away = withLineups(createClubRecord("a", "Away", "EPL"), [
    { date: "2026-01-01", formation: "4-4-2", starting: xi.map((p) => `${p}2`), opponentId: "x" },
    {
      date: "2026-01-08",
      formation: "4-4-2",
      starting: [...xi.slice(0, 9).map((p) => `${p}2`), "Z2", "Y2"],
      opponentId: "y",
    },
  ]);
  const sig = computeLineupContextSignal(home, away);
  assert.ok(sig.reliability > 0);
  assert.ok(sig.value > 0.5);
});
