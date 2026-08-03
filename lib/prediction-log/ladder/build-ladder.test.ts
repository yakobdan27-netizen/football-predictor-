/**
 * Run: npx tsx lib/prediction-log/ladder/build-ladder.test.ts
 */
import assert from "node:assert/strict";
import {
  buildLadder,
  riskExposureFor,
  selectDiversifiedLegs,
  sortDropOrder,
  FILL_FROM_DB,
  LADDER_CONFIG,
} from "./build-ladder";
import { compareTwoHHeavy } from "@/lib/prediction-log/two-h-heavy";
import { suggestStakeSplit } from "./stake-split";
import type { TwoHHeavyResult } from "@/lib/prediction-log/two-h-heavy";
import type { PredictionBatch } from "@/lib/prediction-log/types";

function fakeResult(
  id: string,
  p: number,
  conf: number,
  league = "Premier League",
  home = `H${id}`,
  away = `A${id}`
): TwoHHeavyResult {
  return {
    matchId: id,
    homeTeam: home,
    awayTeam: away,
    league,
    p_2h_gt_1h: p,
    p_2h_eq_1h: 0.1,
    p_2h_lt_1h: 1 - p - 0.1,
    expected_1h: 1,
    expected_2h: 1.2,
    confidence: conf,
    data_source: "db",
    thinData: conf < 0.5,
    partlyFromApi: false,
    insufficientData: conf < 0.5,
    homeProfile: {
      team: home,
      venue: "home",
      sc_1h: 0.5,
      sc_2h: 0.7,
      conc_1h: 0.5,
      conc_2h: 0.6,
      n_matches: 8,
      last_match_date: "2026-07-01",
      source: "db",
    },
    awayProfile: {
      team: away,
      venue: "away",
      sc_1h: 0.5,
      sc_2h: 0.7,
      conc_1h: 0.5,
      conc_2h: 0.6,
      n_matches: 8,
      last_match_date: "2026-07-01",
      source: "db",
    },
    live: false,
  };
}

function batchFrom(ranked: TwoHHeavyResult[]): PredictionBatch {
  return {
    id: "b1",
    date: "2026-07-20",
    league: "Mixed",
    batchName: "Test",
    createdAt: "2026-07-20T00:00:00.000Z",
    matches: ranked.map((r) => ({
      id: r.matchId,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      matchDate: "2026-07-20T15:00:00.000Z",
      predictions: {},
      actualResults: {},
      scored: {},
    })),
  };
}

// --- Top 10 selection; no padding ---
{
  const ranked = Array.from({ length: 12 }, (_, i) =>
    fakeResult(`m${i}`, 0.7 - i * 0.01, 0.9)
  );
  const ladder = buildLadder({
    ranked,
    batch: batchFrom(ranked),
    maxPerLeague: 10,
  });
  assert.equal(ladder.n, 10);
  assert.equal(ladder.rounds.length, 10);
  assert.equal(ladder.shortfallNotice, null);
}

{
  const ranked = Array.from({ length: 4 }, (_, i) =>
    fakeResult(`s${i}`, 0.65 - i * 0.02, 0.8)
  );
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  assert.equal(ladder.n, 4);
  assert.equal(ladder.rounds.length, 4);
  assert.ok(ladder.shortfallNotice?.includes("confidence floor"));
  assert.ok(ladder.shortfallNotice?.includes("Only 4"));
}

// --- Drop order = ascending p×confidence; R_k has n-k+1 legs ---
{
  // All conf >= floor. survival: mStrong=0.8, mMid=0.6, mWeak=0.5*0.6=0.3
  const ranked = [
    fakeResult("mStrong", 0.8, 1),
    fakeResult("mMid", 0.6, 1),
    fakeResult("mWeak", 0.5, 0.6),
  ];
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  assert.deepEqual(ladder.dropOrder, ["A", "B", "C"]);
  const weak = ladder.matches.find((m) => m.matchId === "mWeak");
  assert.equal(weak?.letter, "A");
  const strong = ladder.matches.find((m) => m.matchId === "mStrong");
  assert.equal(strong?.letter, "C");

  for (let k = 1; k <= 3; k++) {
    assert.equal(ladder.rounds[k - 1]!.bets, 3 - k + 1);
  }
  assert.deepEqual(ladder.rounds[2]!.legIds, ["mStrong"]);
  assert.ok(ladder.rounds[0]!.legIds.includes("mWeak"));
  assert.ok(!ladder.rounds[1]!.legIds.includes("mWeak"));
}

// --- Combined product ---
{
  const ranked = [fakeResult("a", 0.5, 1), fakeResult("b", 0.4, 1)];
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  assert.ok(Math.abs(ladder.rounds[0]!.combined_prob! - 0.2) < 1e-9);
}

// --- Missing prob → FILL FROM DB ---
{
  const bad = fakeResult("bad", NaN, 1);
  const ok = fakeResult("ok", 0.7, 1);
  const ladder = buildLadder({
    ranked: [ok, bad],
    batch: batchFrom([ok, bad]),
  });
  const badRow = ladder.matches.find((m) => m.matchId === "bad");
  assert.equal(badRow?.p2h_display, FILL_FROM_DB);
  const r1 = ladder.rounds[0]!;
  assert.equal(r1.combined_display, FILL_FROM_DB);
  assert.equal(r1.combined_prob, null);
}

// --- Risk badges ---
{
  assert.equal(
    riskExposureFor({ combined_prob: 0.05, bets: 10, riskyCount: 0 }),
    "HIGH"
  );
  assert.equal(
    riskExposureFor({ combined_prob: 0.5, bets: 5, riskyCount: 3 }),
    "HIGH"
  );
  assert.equal(
    riskExposureFor({ combined_prob: 0.15, bets: 5, riskyCount: 0 }),
    "Medium"
  );
  assert.equal(
    riskExposureFor({ combined_prob: 0.4, bets: 2, riskyCount: 0 }),
    "Very Low"
  );
  assert.equal(
    riskExposureFor({ combined_prob: 0.4, bets: 5, riskyCount: 0 }),
    "Low"
  );
}

// --- Stake split ---
{
  const ranked = [fakeResult("a", 0.8, 1), fakeResult("b", 0.7, 1)];
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  const stakes = suggestStakeSplit(100, ladder.rounds);
  const sum = stakes.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.02, `sum=${sum}`);
  assert.ok(stakes[1]! > stakes[0]!);
}

// --- Diversity: no league exceeds max while others qualify ---
{
  const ranked: TwoHHeavyResult[] = [];
  // Four leagues with plenty of floor-passers → fill 10 without relaxing past 3
  for (let i = 0; i < 5; i++) {
    ranked.push(fakeResult(`pl${i}`, 0.8 - i * 0.01, 0.9, "Premier League"));
  }
  for (let i = 0; i < 5; i++) {
    ranked.push(fakeResult(`l1${i}`, 0.79 - i * 0.01, 0.9, "Ligue 1"));
  }
  for (let i = 0; i < 5; i++) {
    ranked.push(fakeResult(`sa${i}`, 0.78 - i * 0.01, 0.9, "Serie A"));
  }
  for (let i = 0; i < 5; i++) {
    ranked.push(fakeResult(`bl${i}`, 0.77 - i * 0.01, 0.9, "Bundesliga"));
  }
  const ladder = buildLadder({
    ranked,
    batch: batchFrom(ranked),
    maxPerLeague: 3,
    confFloor: 0.55,
    ladderSize: 10,
  });
  const counts = ladder.selection.leagueCounts;
  assert.equal(ladder.selection.relaxReason, null);
  for (const [lg, n] of Object.entries(counts)) {
    assert.ok(n <= 3, `${lg} has ${n} > 3`);
  }
  assert.equal(ladder.n, 10);
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, ladder.n);
  assert.ok(Object.keys(counts).length >= 3);
  for (const m of ladder.matches) {
    assert.ok((m.confidence ?? 0) >= 0.55);
  }
}

// --- Every selected clears floor ---
{
  const ranked = [
    fakeResult("hi", 0.8, 0.9, "Premier League"),
    fakeResult("lo", 0.9, 0.4, "La Liga"), // below floor
    fakeResult("ok", 0.7, 0.6, "Serie A"),
  ];
  const ladder = buildLadder({
    ranked,
    batch: batchFrom(ranked),
    confFloor: 0.55,
  });
  assert.ok(!ladder.matches.some((m) => m.matchId === "lo"));
  for (const m of ladder.matches) {
    assert.ok((m.confidence ?? 0) >= 0.55);
  }
}

// --- maxPerLeague=10 matches old global top-10 ---
{
  const ranked = Array.from({ length: 15 }, (_, i) => {
    const leagues = [
      "Premier League",
      "Ligue 1",
      "Serie A",
      "Bundesliga",
      "La Liga",
    ];
    return fakeResult(
      `g${i}`,
      0.8 - i * 0.02,
      0.9 - (i % 3) * 0.05,
      leagues[i % leagues.length]!
    );
  });
  const oldTop = [...ranked]
    .sort(compareTwoHHeavy)
    .slice(0, 10)
    .map((r) => r.matchId);
  const ladder = buildLadder({
    ranked,
    batch: batchFrom(ranked),
    maxPerLeague: 10,
    confFloor: 0.55,
  });
  assert.deepEqual(
    ladder.matches
      .slice()
      .sort((a, b) => {
        // selection order is drop order; compare selected set IDs to old top
        return 0;
      })
      .map((m) => m.matchId)
      .sort(),
    [...oldTop].sort()
  );
  // Selection order among greedy with cap=10 should be compareTwoHHeavy order
  const pick = selectDiversifiedLegs(ranked, {
    ladderSize: 10,
    confFloor: 0.55,
    maxPerLeague: 10,
  });
  assert.deepEqual(
    pick.selected.map((r) => r.matchId),
    oldTop
  );
}

// --- Below-floor never selected for balance ---
{
  const ranked = [
    fakeResult("a1", 0.8, 0.9, "Premier League"),
    fakeResult("a2", 0.79, 0.9, "Premier League"),
    fakeResult("weak", 0.99, 0.3, "La Liga"),
  ];
  const pick = selectDiversifiedLegs(ranked, {
    ladderSize: 10,
    confFloor: 0.55,
    maxPerLeague: 1,
  });
  assert.ok(!pick.selected.some((r) => r.matchId === "weak"));
  assert.equal(pick.qualifiedCount, 2);
}

// --- TIE_BAND: drop most-represented league first when survival near-equal ---
{
  const a = fakeResult("pl1", 0.7, 0.8, "Premier League"); // survival 0.56
  const b = fakeResult("pl2", 0.7, 0.8, "Premier League"); // survival 0.56
  const c = fakeResult("sa1", 0.7, 0.8, "Serie A"); // survival 0.56
  const ordered = sortDropOrder([a, b, c], LADDER_CONFIG.TIE_BAND);
  // Two PL + one SA → PL thinned first (two of first two drops should be PL-heavy)
  const firstTwoLeagues = ordered.slice(0, 2).map((r) => r.league);
  assert.equal(firstTwoLeagues.filter((l) => l === "Premier League").length, 2);
  assert.equal(ordered[2]!.league, "Serie A");
}

// --- League attached on LadderMatch ---
{
  const ranked = [fakeResult("x", 0.7, 0.9, "Bundesliga")];
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  assert.equal(ladder.matches[0]!.league, "Bundesliga");
}

console.log("ladder build-ladder tests passed");
