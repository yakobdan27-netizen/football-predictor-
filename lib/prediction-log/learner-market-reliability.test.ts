import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateLossRecoveryRules,
} from "./learner-market-rules";
import {
  aggregateMarketReliability,
  computeReliabilityScoreBoost,
  lookupPortfolioReliabilityBoost,
  mergeWinningAlternatives,
  portfolioLegToMarketSelection,
  winningAlternativesFromMarketRows,
  type MarketTableWinRow,
} from "./learner-market-reliability";
import type { MarketReliabilityEntry } from "./types";
import type { WeekendPickOutcomeExtract } from "./persist-weekend-learner-db";
import { selectionKey } from "./weekend-market-results";

function marketRow(
  partial: Partial<MarketTableWinRow> & Pick<MarketTableWinRow, "selection" | "result">
): MarketTableWinRow {
  return {
    weekendBatchId: "WEEKEND-2026-08-30",
    matchId: "m1",
    providerFixtureId: 101,
    league: "Premier League",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    matchDate: "2026-08-30",
    line: null,
    actualValue: null,
    wasWeekendPick: 0,
    marketFamily: "corner",
    ...partial,
  };
}

test("aggregateMarketReliability credits home-side markets to home team only", () => {
  const rows: MarketTableWinRow[] = [
    marketRow({
      marketFamily: "corner",
      selection: selectionKey("home_corners_ou", "over"),
      line: 5.5,
      result: "win",
    }),
    marketRow({
      marketFamily: "corner",
      selection: selectionKey("home_corners_ou", "over"),
      line: 5.5,
      result: "win",
    }),
    marketRow({
      marketFamily: "corner",
      selection: selectionKey("home_corners_ou", "over"),
      line: 5.5,
      result: "loss",
    }),
  ];
  const agg = aggregateMarketReliability(rows);
  const row = agg.find((r) => r.team === "Arsenal");
  assert.ok(row);
  assert.equal(row!.wins, 2);
  assert.equal(row!.losses, 1);
  assert.equal(row!.sample, 3);
  assert.equal(row!.winRate, 67);
});

test("aggregateMarketReliability credits match-level markets to both teams", () => {
  const rows: MarketTableWinRow[] = [
    marketRow({
      marketFamily: "totalGoals",
      selection: selectionKey("total_goals_ou", "over"),
      line: 2.5,
      result: "win",
    }),
    marketRow({
      marketFamily: "totalGoals",
      selection: selectionKey("total_goals_ou", "over"),
      line: 2.5,
      result: "win",
    }),
    marketRow({
      marketFamily: "totalGoals",
      selection: selectionKey("total_goals_ou", "over"),
      line: 2.5,
      result: "win",
    }),
  ];
  const agg = aggregateMarketReliability(rows);
  const home = agg.find((r) => r.team === "Arsenal");
  const away = agg.find((r) => r.team === "Chelsea");
  assert.ok(home && away);
  assert.equal(home!.wins, 3);
  assert.equal(away!.wins, 3);
});

test("portfolioLegToMarketSelection maps corners and combo legs", () => {
  const corners = portfolioLegToMarketSelection("corners", {
    family: "CORNERS",
    selectionKey: "over_9_5",
    line: 9.5,
  });
  assert.deepEqual(corners, {
    marketFamily: "corner",
    selection: selectionKey("corners_ou", "over"),
    line: 9.5,
    teamSide: "match",
  });

  const combo = portfolioLegToMarketSelection("combo", {
    family: "COMBO",
    selectionKey: "home_btts_yes",
    comboId: "home_btts_yes",
  });
  assert.deepEqual(combo, {
    marketFamily: "combo",
    selection: "home_btts_yes",
    line: null,
    teamSide: "match",
  });

  const gbh = portfolioLegToMarketSelection("goal_both_halves", {
    family: "HALF_GOALS",
    selectionKey: "goal_both_halves",
  });
  assert.equal(gbh?.selection, selectionKey("goal_both_halves", "yes"));
});

test("computeReliabilityScoreBoost caps positive and negative adjustments", () => {
  assert.equal(computeReliabilityScoreBoost(80, 5), 5);
  assert.equal(computeReliabilityScoreBoost(40, 5), 0);
  assert.equal(computeReliabilityScoreBoost(20, 4), -3);
});

test("lookupPortfolioReliabilityBoost applies boost from matching entry", () => {
  const entries: MarketReliabilityEntry[] = [
    {
      team: "Arsenal",
      league: "Premier League",
      marketFamily: "corner",
      selection: selectionKey("corners_ou", "over"),
      line: 9.5,
      winRate: 80,
      sample: 5,
      ruleText: "Arsenal — Total corners O/U over 9.5 wins 4/5 weekend pool weeks (80%) in Premier League.",
    },
  ];
  const mapping = portfolioLegToMarketSelection("corners", {
    family: "CORNERS",
    selectionKey: "over_9_5",
    line: 9.5,
  })!;
  const result = lookupPortfolioReliabilityBoost({
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    league: "Premier League",
    mapping,
    entries,
  });
  assert.equal(result.boost, 5);
  assert.ok(result.note?.includes("Weekend pool history"));
});

test("winningAlternativesFromMarketRows merges combo and numeric winners", () => {
  const wins: MarketTableWinRow[] = [
    marketRow({
      marketFamily: "bttsHalves",
      selection: selectionKey("btts", "yes"),
      result: "win",
    }),
    marketRow({
      marketFamily: "combo",
      selection: "home_btts_yes",
      result: "win",
    }),
  ];
  const alts = winningAlternativesFromMarketRows(
    { marketKey: "corners_ou", prediction: "over", line: 9.5 },
    wins
  );
  assert.equal(alts.length, 2);
  assert.ok(alts.some((a) => a.market === "btts" && a.prediction === "yes"));
  assert.ok(alts.some((a) => a.market === "combo" && a.prediction === "home_btts_yes"));
});

test("aggregateLossRecoveryRules uses market-table winners for wrong picks", () => {
  const wrong: WeekendPickOutcomeExtract = {
    batchId: "WEEKEND-CORNERS-2026-08-30",
    matchId: "m1",
    providerFixtureId: 101,
    weekendSurface: "CORNERS",
    league: "Premier League",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    matchDate: "2026-08-30",
    marketKey: "corners_ou",
    prediction: "over",
    line: 9.5,
    confidence: 60,
    result: "wrong",
    actualValue: "8",
    lossReason: null,
    ftHome: 2,
    ftAway: 1,
    htHome: 1,
    htAway: 0,
    cornersHome: 4,
    cornersAway: 4,
  };

  const marketWins = new Map<string, MarketTableWinRow[]>([
    [
      "WEEKEND-CORNERS-2026-08-30|m1",
      [
        marketRow({
          weekendBatchId: "WEEKEND-CORNERS-2026-08-30",
          marketFamily: "bttsHalves",
          selection: selectionKey("btts", "yes"),
          result: "win",
        }),
      ],
    ],
  ]);

  for (let i = 0; i < 3; i++) {
    wrong.batchId = `WEEKEND-CORNERS-2026-08-3${i}`;
    marketWins.set(`WEEKEND-CORNERS-2026-08-3${i}|m1`, marketWins.get("WEEKEND-CORNERS-2026-08-30|m1")!);
  }

  const outcomes = [0, 1, 2].map((i) => ({
    ...wrong,
    batchId: `WEEKEND-CORNERS-2026-08-3${i}`,
  }));

  const rules = aggregateLossRecoveryRules(outcomes, marketWins);
  assert.ok(rules.some((r) => r.winMarket === "btts" || r.winMarket === "combo"));
});

test("mergeWinningAlternatives dedupes by market signature", () => {
  const merged = mergeWinningAlternatives(
    [{ market: "btts", prediction: "yes" }],
    [{ market: "btts", prediction: "yes" }, { market: "combo", prediction: "home_btts_yes" }]
  );
  assert.equal(merged.length, 2);
});
