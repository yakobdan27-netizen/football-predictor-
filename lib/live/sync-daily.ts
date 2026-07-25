import { sleep } from "@/lib/football-api/client";
import { LEAGUE_API_IDS, apiSeasonFromDate } from "@/lib/football-api/leagues";
import { LIVE_SYNC_LEAGUES } from "./constants";
import { addDaysIso, todayIsoDate } from "./dates";
import { apiSportsLiveProvider, type LiveFixturesProvider } from "./provider";
import { applyApiFixtures, safeApply, type SyncSummary } from "./sync-apply";

/**
 * Daily fixture sweep — full season (or from/to fallback for Free plan).
 */
export async function runDailySweep(
  provider: LiveFixturesProvider = apiSportsLiveProvider
): Promise<SyncSummary & { leaguesTried: number }> {
  const season = apiSeasonFromDate(todayIsoDate());
  const asOf = todayIsoDate();
  let upserted = 0;
  let settledEmitted = 0;
  const warnings: string[] = [];
  let leaguesTried = 0;

  for (const name of LIVE_SYNC_LEAGUES) {
    const leagueId = LEAGUE_API_IDS[name];
    leaguesTried += 1;
    const one = await safeApply(`daily:${name}`, async () => {
      const raw = await fetchSeasonWithFallbacks(
        provider,
        leagueId,
        season,
        asOf
      );
      let fixtures = raw.fixtures;
      // Prior-season Free-plan fallback: keep newest ~80 to stay in cron budget
      if (raw.seasonUsed < season && fixtures.length > 80) {
        fixtures = [...fixtures]
          .sort(
            (a, b) =>
              Date.parse(b.fixture.date || "") - Date.parse(a.fixture.date || "")
          )
          .slice(0, 80);
      }
      return applyApiFixtures(fixtures, raw.seasonUsed);
    });
    if (one.ok) {
      upserted += one.upserted;
      settledEmitted += one.settledEmitted;
    } else if (one.error) {
      warnings.push(`${name}: ${one.error}`);
    }
    await sleep(300);
  }

  return {
    ok: warnings.length < LIVE_SYNC_LEAGUES.length,
    upserted,
    settledEmitted,
    leaguesTried,
    warning: warnings.length ? warnings.slice(0, 3).join(" | ") : undefined,
    error:
      warnings.length === LIVE_SYNC_LEAGUES.length
        ? warnings[0]
        : undefined,
  };
}

/**
 * Prefer current season; on Free-plan season blocks try from/to, then prior season.
 * Never invents fixtures — only returns what the API actually provides.
 */
async function fetchSeasonWithFallbacks(
  provider: LiveFixturesProvider,
  leagueId: number,
  season: number,
  asOf: string
): Promise<{ fixtures: Awaited<ReturnType<LiveFixturesProvider["fetchSeasonFixtures"]>>; seasonUsed: number }> {
  try {
    const fixtures = await provider.fetchSeasonFixtures(leagueId, season);
    return { fixtures, seasonUsed: season };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/season|plan|Free/i.test(msg)) throw e;
  }

  try {
    const fixtures = await provider.fetchDateRange(
      leagueId,
      season,
      asOf,
      addDaysIso(asOf, 60)
    );
    if (fixtures.length) return { fixtures, seasonUsed: season };
  } catch {
    // continue to prior season
  }

  // Free plan historically allows ~2022–2024 — walk back a few seasons.
  for (let s = season - 1; s >= season - 3 && s >= 2022; s--) {
    try {
      const fixtures = await provider.fetchSeasonFixtures(leagueId, s);
      if (fixtures.length) return { fixtures, seasonUsed: s };
    } catch {
      // try older
    }
  }

  throw new Error(
    `No accessible season fixtures for league ${leagueId} (tried ${season}…)`
  );
}
