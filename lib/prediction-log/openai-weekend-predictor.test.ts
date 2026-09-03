import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENAI_WEEKEND_PICK_LIMIT, sliceTopWeekendRows } from "@/lib/match-centre/build-weekend-pool";
import type { WeekendOpportunityRow } from "@/lib/match-centre/weekend-opportunities";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import {
  buildOpenAiContext,
  gradeOpenAiPick,
  validateOpenAiPicksResponse,
} from "@/lib/prediction-log/openai-weekend-predictor";
import type {
  LearnerStatsStore,
  LogMatch,
  MarketReliabilityEntry,
} from "@/lib/prediction-log/types";

function stubRow(id: number, pCal: number): WeekendOpportunityRow {
  return {
    apiFixtureId: id,
    league: "Premier League",
    kickoffIso: "2026-09-05T15:00:00.000Z",
    matchLabel: `Home ${id} vs Away ${id}`,
    homeTeam: `Home ${id}`,
    awayTeam: `Away ${id}`,
    marketLabel: "Over 2.5",
    prediction: "Over 2.5",
    probabilityPct: Math.round(pCal * 100),
    pRaw: pCal,
    pCalibrated: pCal,
    rank: id,
    msamGatePassed: true,
    trace: {
      family: "TOTALS",
      selectionKey: "over_2_5",
      pRaw: pCal,
      pCalibrated: pCal,
      nEffective: 40,
      coherenceOk: true,
      noEstimate: false,
      fixtureSource: "api",
      cfeProvenance: null,
    },
  };
}

function stubEstimate(): CanonicalFixtureEstimate {
  return {
    lambdas: {
      home: 1.6,
      away: 1.0,
      home_1h: 0.7,
      away_1h: 0.5,
      home_2h: 0.9,
      away_2h: 0.5,
      home_corners: 5,
      away_corners: 4,
      home_sot: 4,
      away_sot: 3,
    },
    score_matrix: [[0.1]],
    markets: {
      home: 0.5,
      draw: 0.25,
      away: 0.25,
      bttsYes: 0.55,
      bttsNo: 0.45,
      over25: 0.58,
      under25: 0.42,
      p1h: 0.3,
      p2h: 0.45,
      pTie: 0.25,
      p2h_gt_1h: 0.45,
      cornersOver95: 0.52,
      cornersUnder95: 0.48,
      doubleChance: { oneX: 0.72, xTwo: 0.5, oneTwo: 0.75 },
      dieh: { status: "ok", diehYes: 0.6, diehNo: 0.4, nValid: 20 },
      totalGoals: {
        lines: {
          2.5: { over: 0.58, under: 0.42 },
        },
      },
      sot: { status: "insufficient" },
    },
    provenance: {
      api_pct: 60,
      manual_pct: 40,
      ai_pct: 40,
      seasons_used: 3,
      matches_used: 40,
      ess: 40,
      sourceBreakdown: "blended",
    },
    coverage: { ht_pct: 0.8, corners_pct: 0.7 },
    confidence_tier: "medium",
    model_params_version: "test",
    rho: -0.13,
    diagnostics: { lambda1hPlus2h: 2.6, lambdaFt: 2.6, halfSumOk: true },
  } as CanonicalFixtureEstimate;
}

function stubLearnerStats(): LearnerStatsStore {
  return {
    totalScoredPicks: 120,
    totalMatches: 80,
    updatedAt: new Date().toISOString(),
    topReliableRanges: ["1.80-2.20"],
    weakestRanges: ["4.00+"],
    cautiousClubs: [{ clubName: "Burnley", reason: "low sample" }],
    oddsRanges: [{ range: "1.80-2.20", wins: 30, losses: 20, sample: 50 }],
    oddsBandPerformance: [],
    marketPerformance: [],
    clubPerformance: [],
    batchPerformance: [],
    leaguePerformance: [],
    weekendAnalysis: { scored: 0, wins: 0 },
  } as LearnerStatsStore;
}

describe("buildOpenAiContext", () => {
  it("returns summary and per-match model stats", () => {
    const rows = [stubRow(101, 0.62), stubRow(102, 0.58)];
    const estimates: Record<string, CanonicalFixtureEstimate> = {
      "api:101": stubEstimate(),
      "api:102": stubEstimate(),
    };
    const reliability: MarketReliabilityEntry[] = [
      {
        team: "Arsenal",
        league: "Premier League",
        marketFamily: "TOTALS",
        selection: "over_2_5",
        winRate: 62,
        sample: 12,
      },
    ];

    const { summary, matches } = buildOpenAiContext({
      rows,
      estimates,
      learnerStats: stubLearnerStats(),
      reliabilityEntries: reliability,
      historicalByFamily: [
        { marketFamily: "TOTALS", wins: 8, losses: 4, winRate: 66.7 },
      ],
    });

    assert.equal(summary.learnerScoredPicks, 120);
    assert.ok(summary.topTeamMarkets[0]?.includes("Arsenal"));
    assert.equal(summary.openAiHistoricalByFamily.length, 1);
    assert.equal(matches.length, 2);
    const first = matches[0] as {
      apiFixtureId: number;
      modelStats: { over25Pct: number | null } | null;
    };
    assert.equal(first.apiFixtureId, 101);
    assert.equal(first.modelStats?.over25Pct, 58);
  });
});

describe("validateOpenAiPicksResponse", () => {
  it("accepts one valid pick per fixture", () => {
    const picks = validateOpenAiPicksResponse(
      {
        picks: [
          {
            apiFixtureId: 101,
            marketFamily: "TOTALS",
            marketLabel: "Over 2.5",
            selectionKey: "over_2_5",
            line: 2.5,
            prediction: "Over 2.5",
            confidencePct: 65,
            rationale: "Model and learner support overs.",
          },
          {
            apiFixtureId: 102,
            marketFamily: "BTTS",
            marketLabel: "BTTS",
            selectionKey: "yes",
            prediction: "Yes",
            confidencePct: 58,
            rationale: "Both sides score regularly.",
          },
        ],
      },
      [101, 102]
    );

    assert.equal(picks.length, 2);
    assert.equal(picks[0]!.apiFixtureId, 101);
    assert.equal(picks[1]!.marketFamily, "BTTS");
  });

  it("rejects missing fixture ids", () => {
    assert.throws(
      () =>
        validateOpenAiPicksResponse(
          {
            picks: [
              {
                apiFixtureId: 101,
                marketFamily: "TOTALS",
                selectionKey: "over_2_5",
                prediction: "Over 2.5",
                confidencePct: 65,
                rationale: "Test",
              },
            ],
          },
          [101, 102]
        ),
      /missing picks for fixture ids: 102/
    );
  });

  it("rejects HANDICAP family", () => {
    assert.throws(
      () =>
        validateOpenAiPicksResponse(
          {
            picks: [
              {
                apiFixtureId: 101,
                marketFamily: "HANDICAP",
                selectionKey: "home_-1",
                prediction: "Home -1",
                confidencePct: 55,
                rationale: "Not allowed",
              },
            ],
          },
          [101]
        ),
      /missing picks/
    );
  });
});

describe("sliceTopWeekendRows", () => {
  it("returns at most 30 rows", () => {
    const rows = Array.from({ length: 45 }, (_, i) => stubRow(i + 1, 0.9 - i * 0.01));
    const sliced = sliceTopWeekendRows(rows);
    assert.equal(sliced.length, OPENAI_WEEKEND_PICK_LIMIT);
    assert.equal(sliced[0]!.apiFixtureId, 1);
    assert.equal(sliced[29]!.apiFixtureId, 30);
  });
});

describe("gradeOpenAiPick", () => {
  it("grades TOTALS over 2.5 as win when 3+ goals", () => {
    const match: LogMatch = {
      id: "101",
      homeTeam: "Home",
      awayTeam: "Away",
      league: "Premier League",
      matchDate: "2026-09-05",
      apiFixtureId: 101,
      fixtureStatus: "FT",
      predictions: {},
      actualResults: {},
      scored: {},
      teamStats: {
        home: { goals: 2, htGoals: 1, corners: 5 },
        away: { goals: 2, htGoals: 0, corners: 4 },
      },
    };

    const result = gradeOpenAiPick(
      {
        apiFixtureId: 101,
        homeTeam: "Home",
        awayTeam: "Away",
        league: "Premier League",
        kickoffIso: "2026-09-05T15:00:00.000Z",
        marketFamily: "TOTALS",
        selectionKey: "over_2_5",
        line: 2.5,
        comboId: null,
        prediction: "over",
      },
      match
    );

    assert.equal(result, "win");
  });

  it("grades RESULT_1X2 home win", () => {
    const match: LogMatch = {
      id: "102",
      homeTeam: "Home",
      awayTeam: "Away",
      league: "Premier League",
      matchDate: "2026-09-05",
      apiFixtureId: 102,
      fixtureStatus: "FT",
      predictions: {},
      actualResults: {},
      scored: {},
      teamStats: {
        home: { goals: 2, htGoals: 1 },
        away: { goals: 0, htGoals: 0 },
      },
    };

    const result = gradeOpenAiPick(
      {
        apiFixtureId: 102,
        homeTeam: "Home",
        awayTeam: "Away",
        league: "Premier League",
        kickoffIso: "2026-09-05T15:00:00.000Z",
        marketFamily: "RESULT_1X2",
        selectionKey: "home",
        line: null,
        comboId: null,
        prediction: "Home",
      },
      match
    );

    assert.equal(result, "win");
  });
});
