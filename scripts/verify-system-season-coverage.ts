/**
 * Compare API season fixture counts vs system_season_fixtures per Big-5 league.
 * Run: npx tsx scripts/verify-system-season-coverage.ts
 */
import { LEAGUE_API_IDS } from "@/lib/football-api/leagues";
import { LIVE_SYNC_LEAGUES } from "@/lib/live/constants";
import { SYSTEM_SEASON_YEAR } from "@/lib/system-season/constants";
import {
  countSystemSeasonFixtures,
  listAllFixturesForLeagueSeason,
} from "@/lib/system-season/store";

async function main() {
  console.log(`System season coverage verification (season ${SYSTEM_SEASON_YEAR})\n`);

  let totalDb = 0;
  let totalMissingHt = 0;
  let totalMissingCorners = 0;
  let totalMissingLineups = 0;

  for (const league of LIVE_SYNC_LEAGUES) {
    const leagueId = LEAGUE_API_IDS[league];
    if (leagueId == null) continue;

    const dbCount = await countSystemSeasonFixtures(leagueId, SYSTEM_SEASON_YEAR);
    const fixtures = await listAllFixturesForLeagueSeason(
      leagueId,
      SYSTEM_SEASON_YEAR
    );

    let missingHt = 0;
    let missingCorners = 0;
    let missingLineups = 0;

    for (const f of fixtures) {
      if (f.htHome == null || f.htAway == null) missingHt++;
      const completeness = f.dataCompleteness ?? "core-only";
      if (completeness === "core-only") {
        missingCorners++;
        missingLineups++;
      } else if (completeness === "partial") {
        missingLineups++;
      }
    }

    totalDb += dbCount;
    totalMissingHt += missingHt;
    totalMissingCorners += missingCorners;
    totalMissingLineups += missingLineups;

    console.log(
      `${league}: db=${dbCount} FT rows · missing HT=${missingHt} · core-only/partial (corners/lineups gap)=${missingCorners}`
    );
  }

  console.log(
    `\nTotal: ${totalDb} fixtures · missing HT=${totalMissingHt} · enrichment gaps (corners)=${totalMissingCorners} · lineups=${totalMissingLineups}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
