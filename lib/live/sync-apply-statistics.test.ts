import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveApiFixture } from "./types";
import type { LiveFixturesProvider } from "./provider";
import {
  fixtureNeedsStatisticsHydration,
  enrichmentFromApiStatistics,
} from "./hydrate-api-statistics";

/** Mirrors applyApiFixtures statistics gate without DB/API calls. */
function shouldHydrateStatisticsForRow(
  row: LiveApiFixture,
  existing: { homeCorners?: number | null; awayCorners?: number | null } | null,
  enrich?: { homeCorners?: number | null; awayCorners?: number | null } | null
): boolean {
  const status = (row.fixture?.status?.short ?? "").toUpperCase();
  if (status !== "FT" && status !== "AET" && status !== "PEN") return false;
  return fixtureNeedsStatisticsHydration(existing, enrich ?? null);
}

test("shouldHydrateStatisticsForRow targets finished fixtures missing corners", () => {
  const ftRow: LiveApiFixture = {
    fixture: { id: 99, date: "2026-03-15T15:00:00+00:00", status: { short: "FT" } },
    league: { id: 39, name: "Premier League", season: 2025 },
    teams: { home: { name: "Arsenal" }, away: { name: "Chelsea" } },
    goals: { home: 2, away: 1 },
  };

  assert.equal(
    shouldHydrateStatisticsForRow(ftRow, { homeCorners: null, awayCorners: null }),
    true
  );
  assert.equal(
    shouldHydrateStatisticsForRow(ftRow, { homeCorners: 4, awayCorners: 2 }),
    false
  );
  assert.equal(
    shouldHydrateStatisticsForRow(
      { ...ftRow, fixture: { ...ftRow.fixture!, status: { short: "NS" } } },
      { homeCorners: null, awayCorners: null }
    ),
    false
  );
});

test("mock provider statistics produce corner enrichment", async () => {
  const blocks = [
    {
      team: { name: "Arsenal" },
      statistics: [{ type: "Corner Kicks", value: 6 }],
    },
    {
      team: { name: "Chelsea" },
      statistics: [{ type: "Corner Kicks", value: 3 }],
    },
  ];

  const mockProvider: Pick<LiveFixturesProvider, "fetchStatistics"> = {
    async fetchStatistics() {
      return blocks;
    },
  };

  const stats = await mockProvider.fetchStatistics(99);
  const enrich = enrichmentFromApiStatistics(stats, "Arsenal", "Chelsea");
  assert.ok(enrich);
  assert.equal(enrich!.homeCorners, 6);
  assert.equal(enrich!.awayCorners, 3);
});

console.log("sync-apply statistics hydration tests passed");
