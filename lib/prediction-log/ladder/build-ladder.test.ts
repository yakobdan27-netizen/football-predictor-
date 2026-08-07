/**
 * Run: npx tsx lib/prediction-log/ladder/build-ladder.test.ts
 */
import assert from "node:assert/strict";
import {
  buildLadder,
  labelTier,
  rankScore,
  riskExposureFor,
  selectTopLegs,
  sortDropOrder,
  FILL_FROM_DB,
  LADDER_CONFIG,
} from "./build-ladder";
import { suggestStakeSplit } from "./stake-split";
import type { TwoHHeavyResult } from "@/lib/prediction-log/two-h-heavy";
import type { PredictionBatch } from "@/lib/prediction-log/types";

function fakeResult(
  id: string,
  p: number,
  conf: number,
  league = "Premier League",
  home = `H${id}`,
  away = `A${id}`,
  nMatches = 10
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
      n_matches: nMatches,
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
      n_matches: nMatches,
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

function topByRankScore(ranked: TwoHHeavyResult[], n: number): TwoHHeavyResult[] {
  return [...ranked]
    .filter((r) => Number.isFinite(r.p_2h_gt_1h) && Number.isFinite(r.confidence))
    .sort((a, b) => {
      const sa = rankScore(a);
      const sb = rankScore(b);
      if (sb !== sa) return sb - sa;
      if (b.p_2h_gt_1h !== a.p_2h_gt_1h) return b.p_2h_gt_1h - a.p_2h_gt_1h;
      return b.confidence - a.confidence;
    })
    .slice(0, n);
}

// --- Always 10 when ≥10 candidates ---
{
  const ranked = Array.from({ length: 12 }, (_, i) =>
    fakeResult(`m${i}`, 0.7 - i * 0.01, 0.9 - (i % 4) * 0.1)
  );
  const ladder = buildLadder({
    ranked,
    batch: batchFrom(ranked),
    maxPerLeague: 10,
  });
  assert.equal(ladder.n, 10);
  assert.equal(ladder.rounds.length, 10);
  assert.equal(ladder.shortfallNotice, null);
  assert.equal(ladder.weakLadderNotice, null);
  const expected = topByRankScore(ranked, 10);
  assert.deepEqual(
    new Set(ladder.matches.map((m) => m.matchId)),
    new Set(expected.map((r) => r.matchId))
  );
}

// --- Zero-result regression: all conf < 0.20 still returns 10 Tier C + weak notice ---
{
  const ranked = Array.from({ length: 12 }, (_, i) =>
    fakeResult(`w${i}`, 0.8 - i * 0.01, 0.15)
  );
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  assert.equal(ladder.n, 10);
  assert.ok(ladder.weakLadderNotice?.includes("weak"));
  assert.equal(ladder.selection.tierCounts.C, 10);
  assert.equal(ladder.selection.tierCounts.A, 0);
  for (const m of ladder.matches) assert.equal(m.tier, "C");
}

// --- Only 6 entered → short ladder + enter-at-least-10 message ---
{
  const ranked = Array.from({ length: 6 }, (_, i) =>
    fakeResult(`s${i}`, 0.65 - i * 0.02, 0.8)
  );
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  assert.equal(ladder.n, 6);
  assert.equal(ladder.rounds.length, 6);
  assert.ok(ladder.shortfallNotice?.includes("You entered 6"));
  assert.ok(ladder.shortfallNotice?.includes("at least 10"));
  assert.ok(!ladder.shortfallNotice?.toLowerCase().includes("qualified"));
}

// --- Thin sample still selectable (no sample gate) ---
{
  const thin = fakeResult("th", 0.99, 0.99, "Ligue 1", "Hth", "Ath", 3);
  thin.homeProfile = { ...thin.homeProfile, n_matches: 3 };
  thin.awayProfile = { ...thin.awayProfile, n_matches: 2 };
  const ok = fakeResult("ok", 0.5, 0.4);
  const ladder = buildLadder({
    ranked: [thin, ok],
    batch: batchFrom([thin, ok]),
  });
  assert.equal(ladder.n, 2);
  assert.ok(ladder.matches.some((m) => m.matchId === "th"));
}

// --- Low confidence still eligible ---
{
  const lowConf = fakeResult("low", 0.9, 0.15);
  const highConf = fakeResult("high", 0.6, 0.9);
  const pick = selectTopLegs([lowConf, highConf], { ladderSize: 10 });
  assert.equal(pick.candidateCount, 2);
  assert.ok(pick.selected.some((r) => r.matchId === "low"));
}

// --- Diversification: spreads across leagues when pool allows ---
{
  const ranked: TwoHHeavyResult[] = [];
  for (let i = 0; i < 8; i++) {
    ranked.push(fakeResult(`pl${i}`, 0.9 - i * 0.01, 0.9, "Premier League"));
  }
  for (let i = 0; i < 4; i++) {
    ranked.push(fakeResult(`l1${i}`, 0.75 - i * 0.01, 0.85, "Ligue 1"));
  }
  for (let i = 0; i < 3; i++) {
    ranked.push(fakeResult(`sa${i}`, 0.7 - i * 0.01, 0.8, "Serie A"));
  }
  const ladder = buildLadder({
    ranked,
    batch: batchFrom(ranked),
    maxPerLeague: 3,
  });
  assert.equal(ladder.n, 10);
  const counts = ladder.selection.leagueCounts;
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, 10);
  assert.ok((counts["Premier League"] ?? 0) <= 4); // may relax slightly
  assert.ok((counts["Ligue 1"] ?? 0) >= 1);
  assert.ok((counts["Serie A"] ?? 0) >= 1);
}

// --- Cap relaxes when one league dominates ---
{
  const ranked: TwoHHeavyResult[] = [];
  for (let i = 0; i < 12; i++) {
    ranked.push(fakeResult(`pl${i}`, 0.9 - i * 0.01, 0.9, "Premier League"));
  }
  ranked.push(fakeResult("other", 0.5, 0.5, "Ligue 1"));
  const ladder = buildLadder({
    ranked,
    batch: batchFrom(ranked),
    maxPerLeague: 3,
  });
  assert.equal(ladder.n, 10);
  assert.ok(ladder.matches.some((m) => m.matchId === "other"));
  assert.ok((ladder.selection.leagueCounts["Premier League"] ?? 0) >= 7);
  assert.ok(ladder.selection.relaxedTo > 3);
}

// --- maxPerLeague: 10 ≡ plain global top-10 by rank_score ---
{
  const ranked: TwoHHeavyResult[] = [];
  for (let i = 0; i < 12; i++) {
    ranked.push(fakeResult(`pl${i}`, 0.9 - i * 0.01, 0.9, "Premier League"));
  }
  ranked.push(fakeResult("other", 0.5, 0.5, "Ligue 1"));
  const ladder = buildLadder({
    ranked,
    batch: batchFrom(ranked),
    maxPerLeague: 10,
  });
  const expected = topByRankScore(ranked, 10);
  assert.deepEqual(
    new Set(ladder.matches.map((m) => m.matchId)),
    new Set(expected.map((r) => r.matchId))
  );
  assert.equal(ladder.selection.leagueCounts["Premier League"], 10);
  assert.ok(!ladder.matches.some((m) => m.matchId === "other"));
}

// --- Drop order: tier C before B before A; within tier lower score first ---
{
  const ranked = [
    fakeResult("tierA", 0.7, 0.9), // A
    fakeResult("tierB", 0.7, 0.5), // B
    fakeResult("tierC", 0.7, 0.2), // C
    fakeResult("tierC2", 0.6, 0.2), // C weaker score
  ];
  const ordered = sortDropOrder(ranked);
  assert.deepEqual(
    ordered.map((r) => r.matchId),
    ["tierC2", "tierC", "tierB", "tierA"]
  );

  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  const weak = ladder.matches.find((m) => m.matchId === "tierC2");
  assert.equal(weak?.letter, "A");
  assert.equal(weak?.tier, "C");
  const strong = ladder.matches.find((m) => m.matchId === "tierA");
  assert.equal(strong?.letter, "D");
  assert.equal(strong?.tier, "A");
}

// --- TIE_BAND: same tier, near-equal score → drop most-represented league first ---
{
  const ranked = [
    fakeResult("pl1", 0.7, 0.6, "Premier League"), // score 0.42
    fakeResult("pl2", 0.7, 0.6, "Premier League"), // score 0.42
    fakeResult("l1", 0.7, 0.6, "Ligue 1"), // score 0.42
  ];
  // Force selection of all three; leagueCounts PL=2, Ligue1=1
  const ordered = sortDropOrder(ranked, {
    tieBand: 0.03,
    leagueCounts: { "Premier League": 2, "Ligue 1": 1 },
  });
  // Both PL drop before Ligue 1 (same tier, same score band)
  assert.equal(ordered[2]!.matchId, "l1");
  assert.ok(ordered.slice(0, 2).every((r) => r.league === "Premier League"));
}

// --- Tier labels match thresholds; conf unchanged ---
{
  assert.equal(labelTier(0.55), "A");
  assert.equal(labelTier(0.45), "B");
  assert.equal(labelTier(0.449), "C");
  assert.equal(labelTier(0.0), "C");
  const r = fakeResult("x", 0.7, 0.5, "Bundesliga");
  const ladder = buildLadder({ ranked: [r], batch: batchFrom([r]) });
  assert.equal(ladder.matches[0]!.tier, "B");
  assert.equal(ladder.matches[0]!.confidence, 0.5);
  assert.equal(ladder.matches[0]!.league, "Bundesliga");
}

// --- Missing / non-finite prob excluded from selection ---
{
  const bad = fakeResult("bad", NaN, 1);
  const ok = fakeResult("ok", 0.7, 1);
  const ladder = buildLadder({
    ranked: [ok, bad],
    batch: batchFrom([ok, bad]),
  });
  assert.equal(ladder.n, 1);
  assert.equal(ladder.matches[0]!.matchId, "ok");
  assert.equal(ladder.selection.candidateCount, 1);
}

// --- Combined product ---
{
  const ranked = [fakeResult("a", 0.5, 1), fakeResult("b", 0.4, 1)];
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  assert.ok(Math.abs(ladder.rounds[0]!.combined_prob! - 0.2) < 1e-9);
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

// --- FILL FROM DB for missing kickoff ---
{
  const ranked = [fakeResult("x", 0.7, 0.9)];
  const batch = batchFrom(ranked);
  batch.date = "";
  batch.matches[0]!.matchDate = "";
  const ladder = buildLadder({ ranked, batch });
  assert.equal(ladder.matches[0]!.kickoff, FILL_FROM_DB);
}

// --- Quality / why-these copy present ---
{
  const ranked = Array.from({ length: 10 }, (_, i) =>
    fakeResult(`q${i}`, 0.7, i < 6 ? 0.9 : i < 9 ? 0.5 : 0.2)
  );
  const ladder = buildLadder({ ranked, batch: batchFrom(ranked) });
  assert.ok(ladder.qualitySummary?.includes("6 Tier A"));
  assert.ok(ladder.qualitySummary?.includes("3 Tier B"));
  assert.ok(ladder.qualitySummary?.includes("1 Tier C"));
  assert.ok(ladder.whyThese?.includes("No match was filtered out by confidence"));
}

// --- Config: no HARD_MIN / CONF_FLOOR / MIN_SAMPLE on LADDER_CONFIG ---
{
  const keys = Object.keys(LADDER_CONFIG);
  assert.ok(!keys.includes("HARD_MIN"));
  assert.ok(!keys.includes("MIN_SAMPLE_MATCHES"));
  assert.equal(LADDER_CONFIG.MAX_PER_LEAGUE, 3);
  assert.equal(LADDER_CONFIG.CONF_TIERS.C, 0);
}

console.log("ladder build-ladder tests passed");
