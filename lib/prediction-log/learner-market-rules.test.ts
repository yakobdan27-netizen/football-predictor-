import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateLossRecoveryRules,
  findWinningAlternatives,
} from "./learner-market-rules";
import type { WeekendPickOutcomeExtract } from "./persist-weekend-learner-db";

function wrongCornersOver(
  overrides?: Partial<WeekendPickOutcomeExtract>
): WeekendPickOutcomeExtract {
  return {
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
    confidence: 58,
    result: "wrong",
    actualValue: "8",
    lossReason: "Wrong pick",
    ftHome: 2,
    ftAway: 1,
    htHome: 1,
    htAway: 0,
    cornersHome: 4,
    cornersAway: 4,
    ...overrides,
  };
}

test("findWinningAlternatives finds under when over 9.5 lost on 8 corners", () => {
  const alts = findWinningAlternatives(wrongCornersOver());
  assert.ok(
    alts.some(
      (a) => a.market === "corners_ou" && a.prediction === "under" && a.line === 9.5
    )
  );
});

test("aggregateLossRecoveryRules builds rule after 3 wrong corners overs", () => {
  const outcomes = [
    wrongCornersOver({ matchId: "m1" }),
    wrongCornersOver({ matchId: "m2", providerFixtureId: 102 }),
    wrongCornersOver({ matchId: "m3", providerFixtureId: 103 }),
  ];
  const rules = aggregateLossRecoveryRules(outcomes);
  const plRule = rules.find(
    (r) =>
      r.league === "Premier League" &&
      r.lostMarket === "corners_ou" &&
      r.lostPrediction === "over" &&
      r.winMarket === "corners_ou" &&
      r.winPrediction === "under"
  );
  assert.ok(plRule);
  assert.equal(plRule!.sample, 3);
  assert.equal(plRule!.winRate, 100);
  assert.match(plRule!.ruleText, /under.*would have won 100%/i);
});
