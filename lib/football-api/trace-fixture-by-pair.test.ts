import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ApiFootballFixture } from "./map-fixture-to-match";
import {
  chooseFixtureForTrace,
  filterRelevantFixtures,
  isExactOrderedPair,
  isExactOrderedPairByName,
  kickoffFloorMs,
} from "./trace-fixture-by-pair";
import {
  migrateMatchTraceState,
  stampPendingTrace,
  countTraceStatusesAcrossBatches,
} from "@/lib/prediction-log/result-trace";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";

function fixture(opts: {
  id: number;
  homeId: number;
  awayId: number;
  homeName?: string;
  awayName?: string;
  status: string;
  date: string;
}): ApiFootballFixture {
  return {
    fixture: {
      id: opts.id,
      date: opts.date,
      status: { short: opts.status },
    },
    teams: {
      home: { id: opts.homeId, name: opts.homeName ?? "Home" },
      away: { id: opts.awayId, name: opts.awayName ?? "Away" },
    },
    goals: { home: opts.status === "FT" ? 1 : null, away: opts.status === "FT" ? 0 : null },
    score: { halftime: { home: null, away: null } },
  };
}

function stubMatch(partial: Partial<LogMatch> & Pick<LogMatch, "id" | "homeTeam" | "awayTeam">): LogMatch {
  return {
    predictions: {},
    actualResults: {},
    scored: {},
    ...partial,
  };
}

function stubBatch(matches: LogMatch[], createdAt = "2026-07-01T12:00:00.000Z"): PredictionBatch {
  return {
    id: "b1",
    batchName: "Test",
    date: "2026-07-01",
    league: "Premier League",
    createdAt,
    batchKind: "manual",
    matches,
  };
}

describe("chooseFixtureForTrace", () => {
  it("returns RETRY when no candidates (fixture not yet scheduled)", () => {
    const d = chooseFixtureForTrace([]);
    assert.equal(d.kind, "metadata");
    if (d.kind === "metadata") {
      assert.equal(d.state, "RETRY");
    }
  });

  it("fills when exactly one final ordered fixture", () => {
    const f = fixture({
      id: 1,
      homeId: 10,
      awayId: 20,
      status: "FT",
      date: "2026-08-10T15:00:00Z",
    });
    const d = chooseFixtureForTrace([f]);
    assert.equal(d.kind, "fill");
    if (d.kind === "fill") assert.equal(d.fixture.fixture.id, 1);
  });

  it("sets AMBIGUOUS when two finished meetings share the ordered pair", () => {
    const a = fixture({
      id: 1,
      homeId: 10,
      awayId: 20,
      status: "FT",
      date: "2026-08-10T15:00:00Z",
    });
    const b = fixture({
      id: 2,
      homeId: 10,
      awayId: 20,
      status: "AET",
      date: "2026-12-01T15:00:00Z",
    });
    const d = chooseFixtureForTrace([a, b]);
    assert.equal(d.kind, "metadata");
    if (d.kind === "metadata") assert.equal(d.state, "AMBIGUOUS");
  });

  it("sets FOUND_NOT_FINAL for postponed / not-started", () => {
    const f = fixture({
      id: 3,
      homeId: 10,
      awayId: 20,
      status: "PST",
      date: "2026-08-15T15:00:00Z",
    });
    const d = chooseFixtureForTrace([f]);
    assert.equal(d.kind, "metadata");
    if (d.kind === "metadata") assert.equal(d.state, "FOUND_NOT_FINAL");
  });

  it("sets NEEDS_REVIEW for abandoned/void", () => {
    const f = fixture({
      id: 4,
      homeId: 10,
      awayId: 20,
      status: "CANC",
      date: "2026-08-15T15:00:00Z",
    });
    const d = chooseFixtureForTrace([f]);
    assert.equal(d.kind, "metadata");
    if (d.kind === "metadata") assert.equal(d.state, "NEEDS_REVIEW");
  });
});

describe("ordered pair matching", () => {
  it("accepts exact home/away orientation", () => {
    const f = fixture({
      id: 1,
      homeId: 10,
      awayId: 20,
      homeName: "Arsenal",
      awayName: "Chelsea",
      status: "NS",
      date: "2026-08-20T15:00:00Z",
    });
    assert.equal(isExactOrderedPair(f, 10, 20), true);
    assert.equal(isExactOrderedPair(f, 20, 10), false);
    assert.equal(isExactOrderedPairByName(f, "Arsenal", "Chelsea"), true);
    assert.equal(isExactOrderedPairByName(f, "Chelsea", "Arsenal"), false);
  });

  it("rejects reversed home/away (kept pending)", () => {
    const reversed = fixture({
      id: 9,
      homeId: 20,
      awayId: 10,
      homeName: "Chelsea",
      awayName: "Arsenal",
      status: "FT",
      date: "2026-08-20T15:00:00Z",
    });
    const filtered = filterRelevantFixtures([reversed], 10, 20, 0);
    assert.equal(filtered.length, 0);
    const d = chooseFixtureForTrace(filtered);
    assert.equal(d.kind, "metadata");
    if (d.kind === "metadata") assert.equal(d.state, "RETRY");
  });
});

describe("kickoff floor for early predictions", () => {
  it("batch created 30+ days before kickoff still allows later finals", () => {
    const batch = stubBatch([], "2026-07-01T12:00:00.000Z");
    const floor = kickoffFloorMs(batch);
    const earlyFinal = fixture({
      id: 1,
      homeId: 10,
      awayId: 20,
      status: "FT",
      date: "2026-06-01T15:00:00Z",
    });
    const futureFinal = fixture({
      id: 2,
      homeId: 10,
      awayId: 20,
      status: "FT",
      date: "2026-08-10T15:00:00Z",
    });
    const filtered = filterRelevantFixtures(
      [earlyFinal, futureFinal],
      10,
      20,
      floor
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.fixture.id, 2);
  });
});

describe("lazy migration + stamp", () => {
  it("stamps PENDING on new matches", () => {
    const m = stampPendingTrace(
      stubMatch({ id: "m1", homeTeam: "A", awayTeam: "B" })
    );
    assert.equal(m.resultTraceState, "PENDING");
    assert.equal(m.resultFilled, false);
  });

  it("migrates scored legacy matches to FILLED", () => {
    const m = migrateMatchTraceState(
      stubMatch({
        id: "m1",
        homeTeam: "A",
        awayTeam: "B",
        resultSource: "api-football",
        teamStats: {
          home: { goals: 2 },
          away: { goals: 1 },
        },
        scored: { "1x2": "correct" },
      })
    );
    assert.equal(m.resultTraceState, "FILLED");
    assert.equal(m.resultFilled, true);
  });

  it("counts three pending batches sharing the same fixture names", () => {
    const mk = (id: string) =>
      stampPendingTrace(
        stubMatch({ id, homeTeam: "Arsenal", awayTeam: "Chelsea" })
      );
    const batches = [
      stubBatch([mk("a")]),
      stubBatch([mk("b")]),
      stubBatch([mk("c")]),
    ];
    const counts = countTraceStatusesAcrossBatches(batches);
    assert.equal(counts.pending, 3);
    assert.equal(counts.filled, 0);
  });
});
