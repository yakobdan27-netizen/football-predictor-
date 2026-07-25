import { apiSeasonFromDate } from "@/lib/football-api/leagues";
import { LIVE_LEAGUE_IDS } from "./constants";
import { todayIsoDate } from "./dates";
import { apiSportsLiveProvider, type LiveFixturesProvider } from "./provider";
import { applyApiFixtures, safeApply, type SyncSummary } from "./sync-apply";
import { listFixtureIdsNeedingLivePoll } from "./store";

/**
 * Live poller — only hits API when matches are in-play or near kickoff.
 */
export async function runLivePoll(
  provider: LiveFixturesProvider = apiSportsLiveProvider
): Promise<SyncSummary> {
  const season = apiSeasonFromDate(todayIsoDate());
  const ids = await listFixtureIdsNeedingLivePoll().catch(() => [] as number[]);

  if (!ids.length) {
    return {
      ok: true,
      upserted: 0,
      settledEmitted: 0,
      skipped: true,
    };
  }

  return safeApply("live-poll", async () => {
    let raw = await provider.fetchLiveAll();
    // Keep only our tracked leagues
    const leagueSet = new Set(LIVE_LEAGUE_IDS);
    raw = raw.filter((f) => f.league?.id != null && leagueSet.has(f.league.id));

    // Also refresh specific ids that may not appear in live=all yet (pre-kickoff)
    const liveIds = new Set(raw.map((f) => f.fixture.id));
    const missing = ids.filter((id) => !liveIds.has(id));
    if (missing.length) {
      const extra = await provider.fetchByIds(missing.slice(0, 40));
      raw = [...raw, ...extra];
    }

    return applyApiFixtures(raw, season);
  });
}
