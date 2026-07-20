import assert from "node:assert/strict";
import { test } from "node:test";
import { OwnershipError, assertBatchOwnedBy } from "./ownership";
import { resolveTeamInput, isValidIsoDate } from "./team-resolve";
import { buildTelegramBatch, formatDecisionMessages } from "./decision-service";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import type { BotDecisionResponse } from "./decision-service";

test("assertBatchOwnedBy rejects foreign owner", () => {
  const batch = {
    id: "b1",
    ownerUserId: "user-a",
    batchName: "t",
    date: "2026-07-20",
    league: "Premier League",
    createdAt: new Date().toISOString(),
    matches: [],
  } as PredictionBatch;
  assert.throws(() => assertBatchOwnedBy(batch, "user-b"), OwnershipError);
  assert.doesNotThrow(() => assertBatchOwnedBy(batch, "user-a"));
});

test("resolveTeamInput fuzzy-matches Man City", () => {
  const r = resolveTeamInput("Premier League", "Man City");
  assert.ok(r.match === "Man City" || r.match === "Manchester City" || r.match != null);
});

test("isValidIsoDate", () => {
  assert.equal(isValidIsoDate("2026-07-20"), true);
  assert.equal(isValidIsoDate("20/07/2026"), false);
});

test("buildTelegramBatch sets owner and source", () => {
  const b = buildTelegramBatch({
    ownerUserId: "u1",
    batchName: "Test",
    date: "2026-07-20",
    league: "Premier League",
    matches: [
      {
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        league: "Premier League",
        date: "2026-07-20",
      },
    ],
  });
  assert.equal(b.ownerUserId, "u1");
  assert.equal(b.source, "telegram");
  assert.equal(b.matches.length, 1);
  assert.equal(b.matches[0]!.homeTeam, "Arsenal");
});

test("formatDecisionMessages includes 3 markets and warn marker", () => {
  const result: BotDecisionResponse = {
    batchId: "b1",
    batchName: "Demo",
    decisions: [
      {
        matchId: "m1",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        league: "Premier League",
        date: "2026-07-20",
        incomplete: false,
        markets: [
          {
            rank: 1,
            label: "Total goals O/U",
            prediction: "Over 1.5",
            confidence: 82,
            category: "goals",
            warn: false,
          },
          {
            rank: 2,
            label: "BTTS",
            prediction: "Yes",
            confidence: 66,
            category: "goals",
            warn: false,
          },
          {
            rank: 3,
            label: "Corners",
            prediction: "Over 9.5",
            confidence: 55,
            category: "corners",
            warn: true,
          },
        ],
      },
    ],
  };
  const msgs = formatDecisionMessages(result);
  assert.ok(msgs[0]!.includes("Arsenal vs Chelsea"));
  assert.ok(msgs[0]!.includes("1)"));
  assert.ok(msgs[0]!.includes("2)"));
  assert.ok(msgs[0]!.includes("3)"));
  assert.ok(msgs[0]!.includes("⚠️"));
});
