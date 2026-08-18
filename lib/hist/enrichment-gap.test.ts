import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bucketNeedsEnrichment,
  enrichmentGapQueueFromCoverage,
  fixtureNeedsEnrichment,
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

test("bucket with inventory pass but low HT appears in enrichment queue not inventory", () => {
  const b = bucket({
    leagueId: 140,
    season: 2024,
    inventoryPass: true,
    htMissingPct: 40,
    cornersMissingPct: 5,
    completeness: "partial",
  });
  const r = report([b]);
  assert.equal(gapQueueFromCoverage(r).length, 0);
  assert.equal(enrichmentGapQueueFromCoverage(r).length, 1);
});

test("bucket at full HT and corners thresholds is excluded from enrichment queue", () => {
  const b = bucket({
    leagueId: 39,
    season: 2024,
    completeness: "full",
    htMissingPct: 5,
    cornersMissingPct: 10,
    with_ht_score: 361,
    with_corners: 342,
  });
  const r = report([b]);
  assert.equal(enrichmentGapQueueFromCoverage(r).length, 0);
});

test("fixtureNeedsEnrichment detects missing HT and corners", () => {
  assert.equal(
    fixtureNeedsEnrichment({
      htHome: null,
      htAway: 1,
      statsRowCount: 2,
      statsRowsWithCorners: 2,
    }).needsHt,
    true
  );
  assert.equal(
    fixtureNeedsEnrichment({
      htHome: 1,
      htAway: 0,
      statsRowCount: 2,
      statsRowsWithCorners: 1,
    }).needsCorners,
    true
  );
  assert.equal(
    fixtureNeedsEnrichment({
      htHome: 1,
      htAway: 0,
      statsRowCount: 2,
      statsRowsWithCorners: 2,
    }).needsAny,
    false
  );
});
