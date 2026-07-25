import {
  normalizeFixture,
  normalizeLeague,
} from "./normalize";
import type { LiveFixturesProvider } from "./provider";
import { upsertFixtures, upsertLeague } from "./store";
import type { LiveApiFixture } from "./types";

export async function applyApiFixtures(
  raw: LiveApiFixture[],
  seasonFallback: number
): Promise<{ upserted: number; settledEmitted: number; leagues: number }> {
  const syncedAt = new Date();
  const leaguesSeen = new Map<number, ReturnType<typeof normalizeLeague>>();
  const fixtures = [];

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
  return {
    upserted: result.upserted,
    settledEmitted: result.settledEmitted,
    leagues: leaguesSeen.size,
  };
}

export type SyncSummary = {
  ok: boolean;
  upserted: number;
  settledEmitted: number;
  skipped?: boolean;
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
