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
  resolveConfTiers,
} from "./build-ladder";
import { compareTwoHHeavy } from "@/lib/prediction-log/two-h-heavy";
import { suggestStakeSplit } from "./stake-split";
import type { TwoHHeavyResult } from "@/lib/prediction-log/two-h-heavy";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import type { ConfTier } from "./config";

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

// --- Top 10 selection; no padding below HARD_MIN ---
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
  assert.equal(ladder.mixNotice, null); // all Tier A
}

{
  const ranked = Array.from({ length: 4 }, (_, i) =>
    fakeResult(`s${i}`, 0.65 - i * 0.02, 0.8)
  );
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  assert.equal(ladder.n, 4);
  assert.equal(ladder.rounds.length, 4);
  assert.ok(ladder.shortfallNotice?.includes("minimum"));
  assert.ok(ladder.shortfallNotice?.includes("Only 4"));
}

// --- Drop order within same tier = ascending p×confidence ---
{
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
  for (const m of ladder.matches) assert.equal(m.tier, "A");

  for (let k = 1; k <= 3; k++) {
    assert.equal(ladder.rounds[k - 1]!.bets, 3 - k + 1);
  }
  assert.deepEqual(ladder.rounds[2]!.legIds, ["mStrong"]);
  assert.ok(ladder.rounds[0]!.legIds.includes("mWeak"));
  assert.ok(!ladder.rounds[1]!.legIds.includes("mWeak"));
  assert.ok(ladder.rounds[0]!.leg_percents_display.includes("%"));
  assert.ok(ladder.rounds[0]!.leg_percents_display.includes("C "));
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

// --- Diversity: no league exceeds max while others qualify (Tier A) ---
{
  const ranked: TwoHHeavyResult[] = [];
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
  const tierSum =
    ladder.selection.tierCounts.A +
    ladder.selection.tierCounts.B +
    ladder.selection.tierCounts.C;
  assert.equal(tierSum, ladder.n);
  for (const m of ladder.matches) {
    assert.ok((m.confidence ?? 0) >= LADDER_CONFIG.HARD_MIN);
    assert.equal(m.tier, "A");
  }
}

// --- Tier preference: no B while unused A exists ---
{
  const ranked = [
    fakeResult("a1", 0.6, 0.9, "Premier League"),
    fakeResult("a2", 0.55, 0.8, "Ligue 1"),
    fakeResult("b1", 0.95, 0.5, "Serie A"), // high p, Tier B only
    fakeResult("c1", 0.99, 0.4, "Bundesliga"),
  ];
  const pick = selectDiversifiedLegs(ranked, {
    ladderSize: 2,
    maxPerLeague: 10,
  });
  assert.deepEqual(
    pick.selected.map((r) => r.matchId).sort(),
    ["a1", "a2"]
  );
  assert.equal(pick.tierById.get("a1"), "A");
  assert.equal(pick.tierById.get("a2"), "A");
}

// --- Backfill B/C to reach 10; never below HARD_MIN ---
{
  const ranked: TwoHHeavyResult[] = [];
  for (let i = 0; i < 3; i++) {
    ranked.push(fakeResult(`a${i}`, 0.7, 0.9, "Premier League"));
  }
  for (let i = 0; i < 4; i++) {
    ranked.push(fakeResult(`b${i}`, 0.7, 0.5, "Ligue 1"));
  }
  for (let i = 0; i < 4; i++) {
    ranked.push(fakeResult(`c${i}`, 0.7, 0.4, "Serie A"));
  }
  ranked.push(fakeResult("junk", 0.99, 0.05, "La Liga")); // below HARD_MIN
  const ladder = buildLadder({
    ranked,
    batch: batchFrom(ranked),
    maxPerLeague: 10,
    ladderSize: 10,
  });
  assert.equal(ladder.n, 10);
  assert.equal(ladder.selection.tierCounts.A, 3);
  assert.equal(ladder.selection.tierCounts.B, 4);
  assert.equal(ladder.selection.tierCounts.C, 3);
  assert.ok(ladder.mixNotice?.includes("Tier A"));
  assert.ok(!ladder.matches.some((m) => m.matchId === "junk"));
  for (const m of ladder.matches) {
    assert.ok((m.confidence ?? 0) >= LADDER_CONFIG.HARD_MIN);
  }
}

// --- Drop order: all C before B before A ---
{
  const ranked = [
    fakeResult("ta", 0.9, 0.9, "Premier League"),
    fakeResult("tb", 0.9, 0.5, "Ligue 1"),
    fakeResult("tc", 0.9, 0.4, "Serie A"),
  ];
  const ladder = buildLadder({
    ranked,
    batch: batchFrom(ranked),
    maxPerLeague: 10,
  });
  const tiers = ladder.matches.map((m) => m.tier);
  assert.deepEqual(tiers, ["C", "B", "A"]);
  assert.equal(ladder.matches[0]!.letter, "A"); // first dropped = Tier C
}

// --- maxPerLeague=10 + enough Tier A ≡ Tier-A top-10 ---
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
  const tierA = ranked
    .filter((r) => r.confidence >= LADDER_CONFIG.CONF_TIERS.A)
    .sort(compareTwoHHeavy);
  const oldTop = tierA.slice(0, 10).map((r) => r.matchId);
  assert.ok(oldTop.length === 10);
  const pick = selectDiversifiedLegs(ranked, {
    ladderSize: 10,
    maxPerLeague: 10,
    confFloor: LADDER_CONFIG.CONF_TIERS.A,
  });
  assert.deepEqual(
    pick.selected.map((r) => r.matchId),
    oldTop
  );
  for (const id of pick.selected.map((r) => r.matchId)) {
    assert.equal(pick.tierById.get(id), "A");
  }
}

// --- Below HARD_MIN never selected for balance ---
{
  const ranked = [
    fakeResult("a1", 0.8, 0.9, "Premier League"),
    fakeResult("a2", 0.79, 0.9, "Premier League"),
    fakeResult("weak", 0.99, 0.05, "La Liga"),
  ];
  const pick = selectDiversifiedLegs(ranked, {
    ladderSize: 10,
    maxPerLeague: 1,
  });
  assert.ok(!pick.selected.some((r) => r.matchId === "weak"));
  assert.equal(pick.qualifiedCount, 2);
}

// --- TIE_BAND within same tier: drop most-represented league first ---
{
  const a = fakeResult("pl1", 0.7, 0.8, "Premier League");
  const b = fakeResult("pl2", 0.7, 0.8, "Premier League");
  const c = fakeResult("sa1", 0.7, 0.8, "Serie A");
  const tierById = new Map<string, ConfTier>([
    ["pl1", "A"],
    ["pl2", "A"],
    ["sa1", "A"],
  ]);
  const ordered = sortDropOrder([a, b, c], {
    tieBand: LADDER_CONFIG.TIE_BAND,
    tierById,
  });
  const firstTwoLeagues = ordered.slice(0, 2).map((r) => r.league);
  assert.equal(firstTwoLeagues.filter((l) => l === "Premier League").length, 2);
  assert.equal(ordered[2]!.league, "Serie A");
}

// --- League + tier attached on LadderMatch ---
{
  const ranked = [fakeResult("x", 0.7, 0.9, "Bundesliga")];
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  assert.equal(ladder.matches[0]!.league, "Bundesliga");
  assert.equal(ladder.matches[0]!.tier, "A");
}

// --- resolveConfTiers ---
{
  const t = resolveConfTiers(0.55);
  assert.equal(t.A, 0.55);
  assert.equal(t.B, 0.45);
  assert.equal(t.C, 0.1);
  const low = resolveConfTiers(0.4);
  assert.equal(low.A, 0.4);
  assert.equal(low.B, 0.3);
  assert.equal(low.C, 0.1);
  const floor = resolveConfTiers(0.1);
  assert.equal(floor.A, 0.1);
  assert.equal(floor.B, 0.1);
  assert.equal(floor.C, 0.1);
}

console.log("ladder build-ladder tests passed");
