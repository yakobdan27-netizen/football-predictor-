import { sleep } from "@/lib/football-api/client";
import { LEAGUE_API_IDS, apiSeasonFromDate } from "@/lib/football-api/leagues";
import { LIVE_SYNC_LEAGUES } from "./constants";
import { addDaysIso, todayIsoDate } from "./dates";
import { apiSportsLiveProvider, type LiveFixturesProvider } from "./provider";
import { applyApiFixtures, safeApply, type SyncSummary } from "./sync-apply";
import { listFixturesKickoffBetween } from "./store";

/**
 * Hourly pre-match refresh — fixtures with kickoff in the next 24h.
 */
export async function runPrematchRefresh(
  provider: LiveFixturesProvider = apiSportsLiveProvider
): Promise<SyncSummary> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60_000);
  const season = apiSeasonFromDate(todayIsoDate());
  const from = todayIsoDate();
  const to = addDaysIso(from, 1);

  // Prefer refreshing known local rows by id when present; also pull date range.
  const local = await listFixturesKickoffBetween(now, horizon).catch(() => []);
  const ids = local.map((f) => f.fixtureId);

  return safeApply("prematch", async () => {
    let upserted = 0;
    let settledEmitted = 0;

    if (ids.length) {
      const byId = await provider.fetchByIds(ids);
      const a = await applyApiFixtures(byId, season);
      upserted += a.upserted;
      settledEmitted += a.settledEmitted;
    }

    for (const name of LIVE_SYNC_LEAGUES) {
      const leagueId = LEAGUE_API_IDS[name];
      try {
        const range = await provider.fetchDateRange(
          leagueId,
          season,
          from,
          to
        );
        const a = await applyApiFixtures(range, season);
        upserted += a.upserted;
        settledEmitted += a.settledEmitted;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[live] prematch ${name}:`, msg);
      }
      await sleep(250);
    }

    return { upserted, settledEmitted };
  });
}
