/**
 * Run: npx tsx lib/prediction-log/ladder/build-ladder.test.ts
 */
import assert from "node:assert/strict";
import { buildLadder, riskExposureFor, FILL_FROM_DB } from "./build-ladder";
import { suggestStakeSplit } from "./stake-split";
import type { TwoHHeavyResult } from "@/lib/prediction-log/two-h-heavy";
import type { PredictionBatch } from "@/lib/prediction-log/types";

function fakeResult(
  id: string,
  p: number,
  conf: number,
  home = `H${id}`,
  away = `A${id}`
): TwoHHeavyResult {
  return {
    matchId: id,
    homeTeam: home,
    awayTeam: away,
    league: "Premier League",
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
    league: "Premier League",
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
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
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
  assert.ok(ladder.shortfallNotice?.includes("Only 4"));
}

// --- Drop order = ascending p×confidence; R_k has n-k+1 legs ---
{
  // survival: mStrong=0.8*1=0.8, mMid=0.6*1=0.6, mWeak=0.5*0.5=0.25
  const ranked = [
    fakeResult("mStrong", 0.8, 1),
    fakeResult("mMid", 0.6, 1),
    fakeResult("mWeak", 0.5, 0.5),
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
  // R1 includes all; R3 is best only (mStrong)
  assert.deepEqual(ladder.rounds[2]!.legIds, ["mStrong"]);
  assert.ok(ladder.rounds[0]!.legIds.includes("mWeak"));
  assert.ok(!ladder.rounds[1]!.legIds.includes("mWeak")); // dropped in R2
}

// --- Combined product ---
{
  const ranked = [
    fakeResult("a", 0.5, 1),
    fakeResult("b", 0.4, 1),
  ];
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

// --- Stake split sums to bankroll; safer rounds get more ---
{
  const ranked = [
    fakeResult("a", 0.8, 1),
    fakeResult("b", 0.7, 1),
  ];
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  const stakes = suggestStakeSplit(100, ladder.rounds);
  const sum = stakes.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 0.02, `sum=${sum}`);
  // R2 (1 leg, higher combined) should get more than R1
  assert.ok(stakes[1]! > stakes[0]!);
}

console.log("ladder build-ladder tests passed");
