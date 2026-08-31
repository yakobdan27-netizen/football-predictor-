import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HIST_INTERLEAVE_INVENTORY_RATIO,
  resolveHistDrainPhase,
} from "./daily-drain";
import {
  enrichmentGapQueueFromCoverage,
  gapQueueFromCoverage,
  type HistCoverageBucket,
  type HistCoverageReport,
} from "./coverage-audit";

function bucket(
  overrides: Partial<HistCoverageBucket> & {
    leagueId: number;
    season: number;
  }
): HistCoverageBucket {
  return {
    leagueName: "Test",
    compType: "league",
    expected_fixtures: 380,
    stored_fixtures: 380,
    with_ht_score: 200,
    with_goal_timings: 350,
    with_match_stats: 350,
    with_corners: 300,
    with_lineups: 0,
    completeness: "partial",
    inventoryPass: true,
    providerHole: false,
    providerHoleReason: null,
    htMissingPct: 47.4,
    cornersMissingPct: 21.1,
    ...overrides,
  };
}

function report(buckets: HistCoverageBucket[]): HistCoverageReport {
  return {
    seasons: [2024],
    buckets,
    summary: {
      full: buckets.filter((b) => b.completeness === "full").length,
      partial: buckets.filter((b) => b.completeness === "partial").length,
      coreOnly: buckets.filter((b) => b.completeness === "core-only").length,
      missing: buckets.filter((b) => b.completeness === "missing").length,
      total: buckets.length,
      inventoryPass: buckets.filter((b) => b.inventoryPass).length,
      providerHoles: buckets.filter((b) => b.providerHole).length,
    },
    perCompetition: [],
  };
}

test("gapQueueFromCoverage seeds empty league before partial PL bucket", () => {
  const plPartial = bucket({
    leagueId: 39,
    leagueName: "Premier League",
    season: 2024,
    inventoryPass: false,
    stored_fixtures: 190,
    expected_fixtures: 380,
    completeness: "missing",
  });
  const laLigaEmpty = bucket({
    leagueId: 140,
    leagueName: "La Liga",
    season: 2015,
    inventoryPass: false,
    stored_fixtures: 0,
    expected_fixtures: 380,
    completeness: "missing",
  });
  const r = report([plPartial, laLigaEmpty]);
  r.perCompetition = [
    { leagueId: 39, leagueName: "Premier League", compType: "league", stored: 190, withCorners: 0, withHt: 0 },
    { leagueId: 140, leagueName: "La Liga", compType: "league", stored: 0, withCorners: 0, withHt: 0 },
  ];
  const gaps = gapQueueFromCoverage(r);
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0]!.leagueId, 140);
  assert.equal(gaps[0]!.season, 2015);
});

test("resolveHistDrainPhase picks inventory when gaps remain and interleave off", () => {
  const invGap = bucket({
    leagueId: 39,
    season: 2020,
    inventoryPass: false,
    stored_fixtures: 100,
    completeness: "missing",
  });
  const enrichGap = bucket({
    leagueId: 140,
    season: 2024,
    inventoryPass: true,
    htMissingPct: 40,
    cornersMissingPct: 5,
  });
  const r = report([invGap, enrichGap]);
  assert.equal(gapQueueFromCoverage(r).length, 1);
  assert.equal(enrichmentGapQueueFromCoverage(r).length, 1);

  const pick = resolveHistDrainPhase(r, { interleave: false });
  assert.equal(pick.phase, "inventory");
  assert.equal(pick.hasWork, true);
  assert.equal(pick.enrichmentGapsRemaining, 1);
});

test("resolveHistDrainPhase interleaves enrichment after inventory ratio", () => {
  const invGap = bucket({
    leagueId: 39,
    season: 2020,
    inventoryPass: false,
    stored_fixtures: 100,
    completeness: "missing",
  });
  const enrichGap = bucket({
    leagueId: 140,
    season: 2024,
    inventoryPass: true,
    htMissingPct: 40,
    cornersMissingPct: 5,
  });
  const r = report([invGap, enrichGap]);

  assert.equal(
    resolveHistDrainPhase(r, {
      interleave: true,
      inventorySinceEnrich: 0,
    }).phase,
    "inventory"
  );
  assert.equal(
    resolveHistDrainPhase(r, {
      interleave: true,
      inventorySinceEnrich: HIST_INTERLEAVE_INVENTORY_RATIO - 1,
    }).phase,
    "inventory"
  );
  assert.equal(
    resolveHistDrainPhase(r, {
      interleave: true,
      inventorySinceEnrich: HIST_INTERLEAVE_INVENTORY_RATIO,
    }).phase,
    "enrichment"
  );
});

test("resolveHistDrainPhase stays inventory when no enrichment gaps", () => {
  const invGap = bucket({
    leagueId: 39,
    season: 2020,
    inventoryPass: false,
    stored_fixtures: 100,
    completeness: "missing",
  });
  const r = report([invGap]);

  assert.equal(enrichmentGapQueueFromCoverage(r).length, 0);
  assert.equal(
    resolveHistDrainPhase(r, {
      interleave: true,
      inventorySinceEnrich: HIST_INTERLEAVE_INVENTORY_RATIO,
    }).phase,
    "inventory"
  );
});

test("resolveHistDrainPhase picks enrichment after inventory gate passes", () => {
  const enrichGap = bucket({
    leagueId: 140,
    season: 2024,
    inventoryPass: true,
    htMissingPct: 40,
    cornersMissingPct: 5,
  });
  const r = report([enrichGap]);
  r.summary.inventoryPass = r.summary.total;

  const pick = resolveHistDrainPhase(r);
  assert.equal(pick.phase, "enrichment");
  assert.equal(pick.hasWork, true);
});

test("resolveHistDrainPhase reports no work when both queues empty", () => {
  const full = bucket({
    leagueId: 39,
    season: 2024,
    completeness: "full",
    htMissingPct: 5,
    cornersMissingPct: 10,
    with_ht_score: 361,
    with_corners: 342,
  });
  const r = report([full]);
  r.summary.inventoryPass = r.summary.total;

  const pick = resolveHistDrainPhase(r);
  assert.equal(pick.hasWork, false);
  assert.equal(pick.enrichmentGapsRemaining, 0);
});
