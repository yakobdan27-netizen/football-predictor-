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
  upsertMatchStats,
} from "./store";
import type { LiveApiFixture, LiveBeSoccerEnrichment } from "./types";
import { sleep } from "@/lib/football-api/client";
import {
  buildFixtureEligibilityContext,
  filterEligibleFixtures,
} from "@/lib/football-api/fixture-eligibility";
import type { NewMatchStats } from "@/lib/db/schema";

export async function applyApiFixtures(
  raw: LiveApiFixture[],
  seasonFallback: number,
  opts?: {
    hydrateEventsOnFt?: boolean;
    provider?: LiveFixturesProvider;
    beSoccerEnrichments?: Map<number, LiveBeSoccerEnrichment>;
    /** When set, filter to men's top-flight roster for this league. */
    expectedLeagueId?: number;
    season?: number;
  }
): Promise<{
  fetched: number;
  upserted: number;
  inserted: number;
  updated: number;
  skipped: number;
  settledEmitted: number;
  matchStatsUpserted: number;
  leagues: number;
  normalizeDropped: number;
  eligibilityDropped: number;
  eventsHydrated: number;
}> {
  const syncedAt = new Date();
  const leaguesSeen = new Map<number, ReturnType<typeof normalizeLeague>>();
  const fixtures = [];
  const provider = opts?.provider ?? apiSportsLiveProvider;
  const hydrateEvents = opts?.hydrateEventsOnFt !== false;
  const enrichments = opts?.beSoccerEnrichments;

  let rows = raw;
  let eligibilityDropped = 0;
  if (opts?.expectedLeagueId != null) {
    const season = opts.season ?? seasonFallback;
    const eligibility = await buildFixtureEligibilityContext(
      opts.expectedLeagueId,
      season
    );
    const filtered = filterEligibleFixtures<LiveApiFixture>(rows, eligibility);
    eligibilityDropped = filtered.dropped;
    rows = filtered.kept;
  }

  for (const row of rows) {
    const league = normalizeLeague(row, seasonFallback);
    if (league) leaguesSeen.set(league.leagueId, league);
    const enrich = enrichments?.get(row.fixture?.id) ?? null;
    const fx = normalizeFixture(row, syncedAt, enrich);
    if (fx) fixtures.push(fx);
  }

  for (const league of leaguesSeen.values()) {
    if (league) await upsertLeague(league);
  }

  const result = await upsertFixtures(fixtures);

  // Also write canonical stats rows when enrichment is present.
  const statsRows: NewMatchStats[] = [];
  const now = syncedAt;
  for (const fx of fixtures) {
    const enrich = enrichments?.get(fx.fixtureId) ?? null;
    if (!enrich) continue;
    const hasStats =
      enrich.besoccerMatchId != null ||
      enrich.homeCorners != null ||
      enrich.homeShots != null ||
      enrich.homePossession != null ||
      enrich.homeXg != null ||
      enrich.homeShotsOnTarget != null ||
      enrich.rawJson != null ||
      (enrich.sourceConflicts?.length ?? 0) > 0;
    if (!hasStats) continue;
    statsRows.push({
      fixtureId: fx.fixtureId,
      statsApiMatchId: enrich.besoccerMatchId ?? null,
      leagueId: fx.leagueId,
      season: fx.season,
      homeTeam: fx.homeTeam,
      awayTeam: fx.awayTeam,
      kickoffUtc: fx.kickoffUtc,
      status: fx.status,
      homeGoals: fx.homeGoals ?? null,
      awayGoals: fx.awayGoals ?? null,
      homeCorners: enrich.homeCorners ?? null,
      awayCorners: enrich.awayCorners ?? null,
      homeShots: enrich.homeShots ?? null,
      awayShots: enrich.awayShots ?? null,
      homePossession: enrich.homePossession ?? null,
      awayPossession: enrich.awayPossession ?? null,
      homeShotsOnTarget: enrich.homeShotsOnTarget ?? null,
      awayShotsOnTarget: enrich.awayShotsOnTarget ?? null,
      homeXg: enrich.homeXg ?? null,
      awayXg: enrich.awayXg ?? null,
      homeBigChances: enrich.homeBigChances ?? null,
      awayBigChances: enrich.awayBigChances ?? null,
      homeGkSaves: enrich.homeGkSaves ?? null,
      awayGkSaves: enrich.awayGkSaves ?? null,
      homeFouls: enrich.homeFouls ?? null,
      awayFouls: enrich.awayFouls ?? null,
      homeYellowCards: enrich.homeYellowCards ?? null,
      awayYellowCards: enrich.awayYellowCards ?? null,
      homeRedCards: enrich.homeRedCards ?? null,
      awayRedCards: enrich.awayRedCards ?? null,
      homePasses: enrich.homePasses ?? null,
      awayPasses: enrich.awayPasses ?? null,
      homeAccuratePasses: enrich.homeAccuratePasses ?? null,
      awayAccuratePasses: enrich.awayAccuratePasses ?? null,
      homeTackles: enrich.homeTackles ?? null,
      awayTackles: enrich.awayTackles ?? null,
      homeFreeKicks: enrich.homeFreeKicks ?? null,
      awayFreeKicks: enrich.awayFreeKicks ?? null,
      rawJson: enrich.rawJson ?? null,
      sourceConflicts:
        enrich.sourceConflicts?.length
          ? JSON.stringify(enrich.sourceConflicts)
          : null,
      provider: "thestatsapi",
      fetchedAt: now,
      updatedAt: now,
    });
  }
  let matchStatsUpserted = 0;
  if (statsRows.length) {
    const statsResult = await upsertMatchStats(statsRows);
    matchStatsUpserted = statsResult.upserted;
  }

  let eventsHydrated = 0;
  if (hydrateEvents) {
    for (const row of rows) {
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
    matchStatsUpserted,
    leagues: leaguesSeen.size,
    normalizeDropped: rows.length - fixtures.length,
    eligibilityDropped,
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
