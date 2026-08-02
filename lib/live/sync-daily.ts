import {
  API_KEY_NOT_CONFIGURED_MSG,
  getApiFootballKey,
  isApiFootballKeyError,
  sleep,
} from "@/lib/football-api/client";
import { LEAGUE_API_IDS, apiSeasonFromDate } from "@/lib/football-api/leagues";
import { normalizeFootballStatus } from "@/lib/football-api/status";
import { LIVE_SYNC_LEAGUES } from "./constants";
import { addDaysIso, todayIsoDate } from "./dates";
import { apiSportsLiveProvider, type LiveFixturesProvider } from "./provider";
import { applyApiFixtures } from "./sync-apply";
import {
  type LiveSyncStatus,
  writeSyncMeta,
} from "./store";

export type LeagueSyncRow = {
  league: string;
  leagueId: number;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
};

export type ScheduleSyncSummary = {
  ok: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  from: string;
  to: string;
  season: number;
  leagues: LeagueSyncRow[];
  settledEmitted: number;
  status: LiveSyncStatus;
  reason: string | null;
  /** @deprecated use inserted+updated */
  upserted: number;
};

/**
 * Rolling 7-day schedule sync for current API season.
 * Does NOT fall back to prior seasons (avoids invisible 2024 FT dumps).
 */
export async function syncSchedule(
  provider: LiveFixturesProvider = apiSportsLiveProvider
): Promise<ScheduleSyncSummary> {
  const from = todayIsoDate();
  const to = addDaysIso(from, 7);
  const season = apiSeasonFromDate(from);

  const emptySummary = (
    status: LiveSyncStatus,
    reason: string,
    errors: string[] = []
  ): ScheduleSyncSummary => ({
    ok: false,
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    upserted: 0,
    errors: errors.length ? errors : [reason],
    from,
    to,
    season,
    leagues: [],
    settledEmitted: 0,
    status,
    reason,
  });

  // --- Preflight key + /status ---
  try {
    getApiFootballKey();
  } catch (e) {
    const reason =
      e instanceof Error ? e.message : API_KEY_NOT_CONFIGURED_MSG;
    const summary = emptySummary("auth", "API key invalid — check env");
    await writeSyncMeta({
      status: "auth",
      reason: summary.reason,
      from,
      to,
      fetched: 0,
      upserted: 0,
    });
    return summary;
  }

  try {
    const rawStatus = await providerFetchStatus();
    const st = normalizeFootballStatus(rawStatus);
    const current = st.requests?.current;
    const limit = st.requests?.limitDay;
    if (
      current != null &&
      limit != null &&
      limit > 0 &&
      current >= limit
    ) {
      const summary = emptySummary("quota", "API quota reached");
      await writeSyncMeta({
        status: "quota",
        reason: summary.reason,
        from,
        to,
        fetched: 0,
        upserted: 0,
      });
      return summary;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      isApiFootballKeyError(msg) ||
      /HTTP 401|HTTP 403|invalid|Unauthorized/i.test(msg)
    ) {
      const summary = emptySummary("auth", "API key invalid — check env");
      await writeSyncMeta({
        status: "auth",
        reason: summary.reason,
        from,
        to,
        fetched: 0,
        upserted: 0,
      });
      return summary;
    }
    // Non-auth status failure: continue sync but note warning
    console.warn("[live] /status preflight failed:", msg);
  }

  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let settledEmitted = 0;
  let usedNextFallback = false;
  const errors: string[] = [];
  const leagues: LeagueSyncRow[] = [];

  async function applyRows(
    name: string,
    leagueId: number,
    raw: Awaited<ReturnType<LiveFixturesProvider["fetchDateRange"]>>,
    seasonForApply: number
  ): Promise<void> {
    const applied = await applyApiFixtures(raw, seasonForApply);
    fetched += applied.fetched;
    inserted += applied.inserted;
    updated += applied.updated;
    skipped += applied.skipped;
    settledEmitted += applied.settledEmitted;
    leagues.push({
      league: name,
      leagueId,
      fetched: applied.fetched,
      inserted: applied.inserted,
      updated: applied.updated,
      skipped: applied.skipped,
    });
    if (applied.fetched > 0 && applied.upserted === 0) {
      const err = `${name}: fetched ${applied.fetched} but inserted+updated=0 (upsert key?)`;
      errors.push(err);
      console.error("[live]", err);
    }
  }

  for (const name of LIVE_SYNC_LEAGUES) {
    const leagueId = LEAGUE_API_IDS[name];
    try {
      let raw = await provider.fetchDateRange(leagueId, season, from, to);
      console.log(
        `[live] schedule ${name} league=${leagueId} season=${season} from=${from} to=${to} results=${raw.length}`
      );

      // Early-season / empty window: fall back to next= upcoming fixtures.
      if (raw.length === 0) {
        try {
          raw = await provider.fetchNext(leagueId, season, 15);
          if (raw.length) {
            usedNextFallback = true;
            console.log(
              `[live] schedule ${name} next=15 season=${season} results=${raw.length}`
            );
          }
        } catch (e) {
          console.warn(
            `[live] next= fallback season=${season} ${name}:`,
            e instanceof Error ? e.message : e
          );
        }
      }

      // Still empty on 2026: try remaining 2025/26 upcoming once.
      if (raw.length === 0 && season >= 2026) {
        try {
          raw = await provider.fetchNext(leagueId, 2025, 15);
          if (raw.length) {
            usedNextFallback = true;
            console.log(
              `[live] schedule ${name} next=15 season=2025 results=${raw.length}`
            );
            await applyRows(name, leagueId, raw, 2025);
            await sleep(250);
            continue;
          }
        } catch (e) {
          console.warn(
            `[live] next= fallback season=2025 ${name}:`,
            e instanceof Error ? e.message : e
          );
        }
      }

      await applyRows(name, leagueId, raw, season);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[live] schedule ${name} failed:`, msg);
      errors.push(`${name}: ${msg}`);
      leagues.push({
        league: name,
        leagueId,
        fetched: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        error: msg,
      });
    }
    await sleep(250);
  }

  const upserted = inserted + updated;
  let status: LiveSyncStatus;
  let reason: string | null;
  let ok: boolean;

  if (errors.length === LIVE_SYNC_LEAGUES.length) {
    status = /quota|rate|limit/i.test(errors[0] ?? "")
      ? "quota"
      : /season|plan|Free|401|403|key/i.test(errors[0] ?? "")
        ? /401|403|key|not configured/i.test(errors[0] ?? "")
          ? "auth"
          : "error"
        : "error";
    reason = errors[0] ?? "All league syncs failed";
    ok = false;
  } else if (fetched === 0 && errors.length === 0) {
    status = "empty";
    reason = `No matches scheduled between ${from} and ${to} (next= also empty)`;
    ok = true;
  } else if (fetched > 0 && upserted === 0) {
    status = "error";
    reason =
      errors[0] ??
      "Fetched fixtures but none were written — check fixture_id upsert";
    ok = false;
  } else if (errors.length > 0 && upserted === 0) {
    status = "error";
    reason = errors[0] ?? "Sync failed";
    ok = false;
  } else {
    status = "ok";
    reason =
      errors.length > 0
        ? `Partial sync: ${errors.slice(0, 2).join(" | ")}`
        : usedNextFallback
          ? `Synced ${upserted} fixtures via next= upcoming (7d window sparse)`
          : `Synced ${upserted} fixtures (${from} → ${to})`;
    ok = true;
  }

  await writeSyncMeta({
    status,
    reason,
    from,
    to,
    fetched,
    upserted,
  });

  // Soft-warm 2H-heavy profiles so Ladder/DM see AF half data (never fails sync).
  if (ok && upserted > 0) {
    try {
      const { queryFixturesForTab } = await import("./store");
      const { warmTeamHalfProfiles } = await import(
        "@/lib/prediction-log/two-h-heavy/fetch-profiles"
      );
      const { fixtures } = await queryFixturesForTab({
        tab: "upcoming",
        now: new Date(),
      });
      const requests: {
        team: string;
        league: string;
        venue: "home" | "away";
      }[] = [];
      for (const f of fixtures.slice(0, 10)) {
        const league = f.leagueName ?? "Premier League";
        requests.push({ team: f.homeTeam, league, venue: "home" });
        requests.push({ team: f.awayTeam, league, venue: "away" });
      }
      if (requests.length) {
        await warmTeamHalfProfiles(requests, { maxCalls: 12 });
      }
    } catch {
      /* ignore */
    }
  }

  return {
    ok,
    fetched,
    inserted,
    updated,
    skipped,
    upserted,
    errors,
    from,
    to,
    season,
    leagues,
    settledEmitted,
    status,
    reason,
  };
}

/** Cron alias — same as syncSchedule. */
export async function runDailySweep(
  provider: LiveFixturesProvider = apiSportsLiveProvider
): Promise<ScheduleSyncSummary> {
  return syncSchedule(provider);
}

async function providerFetchStatus(): Promise<unknown> {
  const { apiFootballGet } = await import("@/lib/football-api/client");
  return apiFootballGet<unknown>("/status");
}
