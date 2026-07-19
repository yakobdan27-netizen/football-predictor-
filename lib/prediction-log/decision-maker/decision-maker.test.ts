import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureThreeMarkets,
  generateTopThreeMarkets,
  normalisedSourceWeights,
  selectDiverseTopThree,
} from "./decision-engine";
import type {
  AggregatedMatchData,
  DecisionMarketCandidate,
  MatchSourceBundle,
  ScoredDecisionMarket,
} from "./types";
import { listRegisteredResultPages } from "./result-page-registry";

function mk(
  partial: Partial<ScoredDecisionMarket> &
    Pick<ScoredDecisionMarket, "marketKey" | "prediction" | "category" | "confidence">
): ScoredDecisionMarket {
  return {
    label: partial.label ?? partial.marketKey,
    pageId: partial.pageId ?? "test",
    pageLabel: partial.pageLabel ?? "Test",
    totalScore: partial.totalScore ?? partial.confidence,
    contributingPages: partial.contributingPages ?? ["test"],
    ...partial,
  };
}

function source(
  pageId: string,
  baseWeight: number,
  markets: DecisionMarketCandidate[],
  ok = true
): MatchSourceBundle {
  return {
    pageId,
    pageLabel: pageId,
    baseWeight,
    markets,
    ok: ok && markets.length > 0,
  };
}

test("registry lists multiple result pages (not a fixed four)", () => {
  const pages = listRegisteredResultPages();
  assert.ok(pages.length >= 6);
  const ids = new Set(pages.map((p) => p.pageId));
  assert.ok(ids.has("combined-odds"));
  assert.ok(ids.has("corners-analysis"));
  assert.ok(ids.has("recommendation"));
  assert.ok(ids.has("highest-scoring-half"));
});

test("normalised weights sum to 1 across available sources", () => {
  const weights = normalisedSourceWeights([
    source("a", 0.3, [
      {
        marketKey: "1x2",
        label: "1X2",
        prediction: "Home",
        confidence: 70,
        category: "goals",
        pageId: "a",
        pageLabel: "A",
      },
    ]),
    source("b", 0.2, [
      {
        marketKey: "corners_ou",
        label: "Corners",
        prediction: "Over 9.5",
        confidence: 70,
        category: "corners",
        pageId: "b",
        pageLabel: "B",
      },
    ]),
    source("c", 0.5, [], false),
  ]);
  const sum = [...weights.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(weights.get("a"), 0.3 / 0.5);
  assert.equal(weights.get("b"), 0.2 / 0.5);
  assert.equal(weights.has("c"), false);
});

test("selectDiverseTopThree prefers goals + corners + specialized", () => {
  const scored = [
    mk({
      marketKey: "1x2",
      prediction: "Home",
      category: "goals",
      confidence: 90,
      totalScore: 27,
    }),
    mk({
      marketKey: "btts",
      prediction: "Yes",
      category: "goals",
      confidence: 88,
      totalScore: 26,
    }),
    mk({
      marketKey: "total_goals_ou",
      prediction: "Over 2.5",
      category: "goals",
      confidence: 85,
      totalScore: 25,
    }),
    mk({
      marketKey: "corners_ou",
      prediction: "Over 9.5",
      category: "corners",
      confidence: 70,
      totalScore: 14,
    }),
    mk({
      marketKey: "hsh",
      prediction: "2H",
      category: "specialized",
      confidence: 65,
      totalScore: 13,
    }),
  ];
  const top = selectDiverseTopThree(scored);
  assert.equal(top.length, 3);
  const cats = new Set(top.map((m) => m.category));
  assert.ok(cats.has("goals"));
  assert.ok(cats.has("corners"));
  assert.ok(cats.has("specialized"));
});

test("ensureThreeMarkets always returns exactly 3", () => {
  const one = [
    mk({
      marketKey: "1x2",
      prediction: "Home",
      category: "goals",
      confidence: 70,
    }),
  ];
  assert.equal(ensureThreeMarkets(one, []).length, 3);
  assert.equal(ensureThreeMarkets([], []).length, 3);
});

test("generateTopThreeMarkets merges multi-source scores and flags incomplete", () => {
  const data: AggregatedMatchData = {
    matchId: "m1",
    batchId: "b1",
    sources: [
      source("recommendation", 0.3, [
        {
          marketKey: "1x2",
          label: "1X2",
          prediction: "Home",
          confidence: 80,
          category: "goals",
          pageId: "recommendation",
          pageLabel: "Reco",
        },
      ]),
      source("corners-analysis", 0.2, [
        {
          marketKey: "corners_ou",
          label: "Corners",
          prediction: "Under 9.5",
          confidence: 70,
          category: "corners",
          pageId: "corners-analysis",
          pageLabel: "Corners",
        },
      ]),
      source("highest-scoring-half", 0.2, [
        {
          marketKey: "hsh",
          label: "HSH",
          prediction: "2H more goals",
          confidence: 66,
          category: "specialized",
          pageId: "highest-scoring-half",
          pageLabel: "HSH",
        },
      ]),
      source("combined-odds", 0.3, [], false),
    ],
  };
  const result = generateTopThreeMarkets(data);
  assert.equal(result.markets.length, 3);
  assert.equal(result.sourceCount, 3);
  assert.equal(result.incomplete, false);
  assert.ok(result.missingSources.includes("combined-odds"));
});

test("incomplete when fewer than 2 sources provide data", () => {
  const data: AggregatedMatchData = {
    matchId: "m1",
    batchId: "b1",
    sources: [
      source("recommendation", 0.3, [
        {
          marketKey: "1x2",
          label: "1X2",
          prediction: "Home",
          confidence: 80,
          category: "goals",
          pageId: "recommendation",
          pageLabel: "Reco",
        },
      ]),
      source("corners-analysis", 0.2, [], false),
    ],
  };
  const result = generateTopThreeMarkets(data);
  assert.equal(result.incomplete, true);
  assert.equal(result.sourceCount, 1);
});
