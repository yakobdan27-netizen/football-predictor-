import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMatchResultToClubs,
  batchesStrictlyBefore,
  clubRecordAsOf,
  createAsOfRegistry,
  extractFtGoals,
  filterEntriesAsOf,
  isStrictlyBefore,
  resolveAsOfClub,
} from "./backtest-asof";
import {
  collectSettledMatches,
  resolveDateWindow,
  runRecoBacktest,
} from "./backtest-engine";
import { createClubRecord, type HistoryEntry } from "./club-record-types";
import type { LogMatch, PredictionBatch } from "./types";
import { SCHEMA_VERSION } from "./types";

function entry(date: string, actual = 1): HistoryEntry {
  return {
    id: `e-${date}-${actual}`,
    date,
    batchId: "b1",
    matchId: "m1",
    opponentId: "opp",
    opponentName: "Opp",
    venue: "home",
    predicted: actual,
    actual,
    result: "hit",
  };
}

function matchWithGoals(
  id: string,
  home: string,
  away: string,
  hg: number,
  ag: number,
  odds?: number
): LogMatch {
  return {
    id,
    homeTeam: home,
    awayTeam: away,
    predictions: odds
      ? { "1x2": { prediction: "home", confidence: 55, odds } }
      : {},
    actualResults: {},
    scored: {},
    teamStats: { home: { goals: hg }, away: { goals: ag } },
    resultSource: "livescore-bulk",
  };
}

function batch(
  id: string,
  date: string,
  matches: LogMatch[],
  league = "Premier League"
): PredictionBatch {
  return {
    id,
    date,
    league,
    batchName: id,
    createdAt: `${date}T12:00:00.000Z`,
    matches,
  };
}

test("isStrictlyBefore excludes same day and future", () => {
  assert.equal(isStrictlyBefore("2025-01-01", "2025-01-02"), true);
  assert.equal(isStrictlyBefore("2025-01-02", "2025-01-02"), false);
  assert.equal(isStrictlyBefore("2025-01-03", "2025-01-02"), false);
});

test("filterEntriesAsOf drops same-day and future history", () => {
  const entries = [
    entry("2025-01-01"),
    entry("2025-01-02"),
    entry("2025-01-03"),
  ];
  const filtered = filterEntriesAsOf(entries, "2025-01-02");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.date, "2025-01-01");
});

test("clubRecordAsOf excludes same-day history from capacity sample", () => {
  let record = createClubRecord("c1", "Alpha", "Premier League");
  record = {
    ...record,
    histories: {
      ...record.histories,
      goalsScored: [
        entry("2025-01-01", 2),
        entry("2025-01-05", 1),
        entry("2025-01-10", 3),
      ],
    },
  };
  const asOf = clubRecordAsOf(record, "2025-01-05");
  assert.equal(asOf.histories.goalsScored.length, 1);
  assert.equal(asOf.histories.goalsScored[0]!.date, "2025-01-01");
  assert.equal(asOf.capacity.sampleSize, 1);
  assert.equal(asOf.bayesianMarkets, undefined);
});

test("batchesStrictlyBefore filters by batch date", () => {
  const batches = [
    batch("a", "2025-01-01", []),
    batch("b", "2025-01-02", []),
    batch("c", "2025-01-03", []),
  ];
  const prior = batchesStrictlyBefore(batches, "2025-01-02");
  assert.deepEqual(
    prior.map((b) => b.id),
    ["a"]
  );
});

test("extractFtGoals reads teamStats", () => {
  const g = extractFtGoals(matchWithGoals("m", "A", "B", 2, 1));
  assert.deepEqual(g, { hg: 2, ag: 1 });
});

test("resolveDateWindow rolling months", () => {
  const today = new Date("2025-07-15T00:00:00.000Z");
  const w3 = resolveDateWindow({ mode: "rolling_3" }, today);
  assert.equal(w3.dateFrom, "2025-04-15");
  const custom = resolveDateWindow(
    { mode: "custom", dateFrom: "2025-01-01", dateTo: "2025-02-01" },
    today
  );
  assert.equal(custom.dateFrom, "2025-01-01");
  assert.equal(custom.dateTo, "2025-02-01");
});

test("collectSettledMatches sorts and filters leagues", () => {
  const batches = [
    batch("b2", "2025-02-01", [matchWithGoals("m2", "C", "D", 0, 0)], "La Liga"),
    batch("b1", "2025-01-01", [matchWithGoals("m1", "A", "B", 1, 0)]),
    batch("b3", "2025-03-01", [matchWithGoals("m3", "E", "F", 3, 2)]),
  ];
  const all = collectSettledMatches(batches, { mode: "full" });
  assert.equal(all.length, 3);
  assert.deepEqual(
    all.map((x) => x.match.id),
    ["m1", "m2", "m3"]
  );
  const plOnly = collectSettledMatches(batches, {
    mode: "full",
    leagues: ["Premier League"],
  });
  assert.equal(plOnly.length, 2);
});

test("applyMatchResultToClubs grows sampleSize after result", () => {
  const registry = createAsOfRegistry();
  const home = resolveAsOfClub(registry, "Alpha", "Premier League");
  const away = resolveAsOfClub(registry, "Beta", "Premier League");
  assert.equal(home.capacity.sampleSize, 0);
  const { home: h2, away: a2 } = applyMatchResultToClubs(
    home,
    away,
    matchWithGoals("m1", "Alpha", "Beta", 2, 1),
    { batchId: "b1", date: "2025-01-01" }
  );
  assert.ok(h2.capacity.sampleSize >= 1);
  assert.ok(a2.capacity.sampleSize >= 1);
  assert.equal(h2.histories.goalsScored[0]!.actual, 2);
  assert.equal(a2.histories.goalsScored[0]!.actual, 1);
});

test("walk-forward does not leak same-day results into peers", () => {
  const batches = [
    batch("day1", "2025-01-01", [
      matchWithGoals("m1", "Alpha", "Beta", 3, 0),
      matchWithGoals("m2", "Gamma", "Delta", 1, 1),
    ]),
    batch("day2", "2025-01-08", [
      matchWithGoals("m3", "Alpha", "Gamma", 2, 1),
    ]),
  ];

  const result = runRecoBacktest({
    batches,
    config: { mode: "full" },
    runId: "test_same_day",
  });

  assert.equal(result.summary.nMatches, 3);
  // First two matches on day1 both see empty clubs (sample 0 path) — still produce picks
  assert.ok(result.rows[0]!.pick1x2);
  assert.ok(result.rows[1]!.pick1x2);
  // Day2 match runs after day1 flush — Alpha should have history
  assert.equal(result.rows[2]!.homeTeam, "Alpha");
  assert.ok(["home", "draw", "away"].includes(result.rows[2]!.pick1x2));
  assert.equal(typeof result.summary.oneX2.accuracy, "number");
  assert.equal(result.summary.ou25.n, 3);
  assert.equal(result.summary.btts.n, 3);
});

test("synthetic sequence aggregates metrics and ROI when odds present", () => {
  const batches: PredictionBatch[] = [];
  const pairs: Array<[string, string]> = [
    ["Alpha", "Beta"],
    ["Gamma", "Delta"],
    ["Alpha", "Gamma"],
    ["Beta", "Delta"],
    ["Alpha", "Delta"],
    ["Beta", "Gamma"],
  ];
  let day = 1;
  for (const [h, a] of pairs) {
    const date = `2025-01-${String(day).padStart(2, "0")}`;
    batches.push(
      batch(`b${day}`, date, [
        matchWithGoals(`m${day}`, h, a, day % 3, (day + 1) % 2, 2.1),
      ])
    );
    day += 1;
  }

  const result = runRecoBacktest({
    batches,
    config: { mode: "full", leagues: ["Premier League"] },
    runId: "test_metrics",
  });

  assert.equal(result.summary.nMatches, 6);
  assert.ok(result.summary.oneX2.brier != null);
  assert.ok(result.summary.roi.n > 0);
  assert.ok(result.monthly.length >= 1);
  assert.ok(result.byLeague["Premier League"]);
  assert.equal(SCHEMA_VERSION > 0, true);
});
