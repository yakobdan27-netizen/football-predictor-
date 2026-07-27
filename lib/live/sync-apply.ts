import {
  normalizeEvents,
  normalizeFixture,
  normalizeLeague,
  isFinishedStatus,
} from "./normalize";
import {
  apiSportsLiveProvider,
  type LiveFixturesProvider,
} from "./provider";
import {
  getEventsForFixture,
  replaceEventsForFixture,
  upsertFixtures,
  upsertLeague,
} from "./store";
import type { LiveApiFixture } from "./types";
import { sleep } from "@/lib/football-api/client";

export async function applyApiFixtures(
  raw: LiveApiFixture[],
  seasonFallback: number,
  opts?: { hydrateEventsOnFt?: boolean; provider?: LiveFixturesProvider }
): Promise<{
  fetched: number;
  upserted: number;
  inserted: number;
  updated: number;
  skipped: number;
  settledEmitted: number;
  leagues: number;
  normalizeDropped: number;
  eventsHydrated: number;
}> {
  const syncedAt = new Date();
  const leaguesSeen = new Map<number, ReturnType<typeof normalizeLeague>>();
  const fixtures = [];
  const provider = opts?.provider ?? apiSportsLiveProvider;
  const hydrateEvents = opts?.hydrateEventsOnFt !== false;

  for (const row of raw) {
    const league = normalizeLeague(row, seasonFallback);
    if (league) leaguesSeen.set(league.leagueId, league);
    const fx = normalizeFixture(row, syncedAt);
    if (fx) fixtures.push(fx);
  }

  for (const league of leaguesSeen.values()) {
    if (league) await upsertLeague(league);
  }

  const result = await upsertFixtures(fixtures);

  let eventsHydrated = 0;
  if (hydrateEvents) {
    for (const row of raw) {
      const status = (row.fixture?.status?.short ?? "").toUpperCase();
      const id = row.fixture?.id;
      if (!id || !isFinishedStatus(status)) continue;
      try {
        const existing = await getEventsForFixture(id);
        if (existing.length) continue;
        const events = await provider.fetchEvents(id);
        const normalized = normalizeEvents(id, events);
        if (normalized.length) {
          await replaceEventsForFixture(id, normalized);
          eventsHydrated += 1;
        }
        await sleep(150);
      } catch {
        // Plan-gated or transient — leave empty (UI shows —)
      }
    }
  }

  return {
    fetched: raw.length,
    upserted: result.upserted,
    inserted: result.inserted,
    updated: result.updated,
    skipped: result.skipped,
    settledEmitted: result.settledEmitted,
    leagues: leaguesSeen.size,
    normalizeDropped: raw.length - fixtures.length,
    eventsHydrated,
  };
}

export type SyncSummary = {
  ok: boolean;
  upserted: number;
  settledEmitted: number;
  /** Live poll no-op when nothing in window */
  skippedRun?: boolean;
  inserted?: number;
  updated?: number;
  skipped?: number;
  warning?: string;
  error?: string;
};

export async function safeApply(
  label: string,
  fn: () => Promise<Omit<SyncSummary, "ok">>
): Promise<SyncSummary> {
  try {
    const r = await fn();
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[live] ${label} failed:`, msg);
    return {
      ok: false,
      upserted: 0,
      settledEmitted: 0,
      error: msg,
      warning: "API unavailable — serving last cached live_* rows.",
    };
  }
}

export type { LiveFixturesProvider };
