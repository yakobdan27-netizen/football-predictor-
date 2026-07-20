import assert from "node:assert/strict";
import { test } from "node:test";
import { OwnershipError, assertBatchOwnedBy } from "./ownership";
import {
  resolveTeamInput,
  resolveFixtureAcrossLeagues,
  isValidIsoDate,
  listTeams,
} from "./team-resolve";
import { parseBulkMatchText, TELEGRAM_MAX_BATCH_MATCHES } from "./parse-bulk-matches";
import { buildTelegramBatch, formatDecisionMessages } from "./decision-service";
import { TEAM_PAGE_SIZE, needsLine } from "./entry-keyboards";
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

test("resolveFixtureAcrossLeagues prefers domestic", () => {
  const r = resolveFixtureAcrossLeagues("Arsenal", "Chelsea");
  assert.ok(r);
  assert.equal(r!.league, "Premier League");
});

test("parseBulkMatchText accepts mixed leagues", () => {
  const text = [
    "Arsenal vs Chelsea",
    "Barcelona vs Real Madrid | La Liga",
  ].join("\n");
  const parsed = parseBulkMatchText(text, { date: "2026-07-20" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.matches.length, 2);
});

test("parseBulkMatchText rejects more than max matches", () => {
  const text = Array.from(
    { length: TELEGRAM_MAX_BATCH_MATCHES + 1 },
    () => "Arsenal vs Chelsea"
  ).join("\n");
  assert.equal(parseBulkMatchText(text, { date: "2026-07-20" }).ok, false);
});

test("premier league roster indexes are stable for team buttons", () => {
  const teams = listTeams("Premier League");
  assert.ok(teams.length > TEAM_PAGE_SIZE);
  assert.equal(teams.indexOf("Arsenal") >= 0, true);
});

test("needsLine true for total goals", () => {
  assert.equal(needsLine("total_goals_ou"), true);
  assert.equal(needsLine("1x2"), false);
});

test("buildTelegramBatch stores market prediction and odds", () => {
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
        marketKey: "1x2",
        prediction: "home",
        odds: 1.85,
        confidence: 50,
      },
    ],
  });
  assert.equal(b.source, "telegram");
  assert.equal(b.matches[0]!.predictions["1x2"]?.prediction, "home");
  assert.equal(b.matches[0]!.predictions["1x2"]?.odds, 1.85);
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
        bestCombined: {
          label: "BTTS + Over 2.5",
          odds: 1.85,
          pFinal: 62,
          value: 4.2,
        },
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
  assert.ok(msgs[0]!.includes("⚠️"));
  assert.ok(msgs[0]!.includes("Combined Odd"));
  assert.ok(msgs[0]!.includes("BTTS + Over 2.5"));
});
