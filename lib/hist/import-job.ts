/**
 * Per league×season hist import: inventory finished fixtures, enrich missing.
 */
import { apiFootballGet, sleep } from "@/lib/apiClient";
import { isFinishedStatus } from "@/lib/live/normalize";
import { apiSportsLiveProvider } from "@/lib/live/provider";
import { getLastQuotaRemaining } from "@/lib/live/rate-limit";
import type { LiveApiFixture } from "@/lib/live/types";
import {
  inferCompleteness,
  mapFixtureCore,
  mapGoalEvents,
  mapLineups,
  mapStatistics,
  mapTeamsFromFixture,
} from "./map";
import { HIST_QUOTA_SAFETY_MARGIN } from "./preflight";
import {
  countFixturesForLeagueSeason,
  getHistFixture,
  hasHistGoals,
  hasHistLineups,
  hasHistStats,
  getHistFixtureEnrichmentState,
  hasHistCorners,
  listFixturesNeedingEnrichment,
  replaceHistGoals,
  replaceHistLineups,
  replaceHistStats,
  updateHistJob,
  upsertHistFixture,
  upsertHistTeams,
} from "./store";

/** Default 20; override via HIST_MAX_ENRICH_PER_CHUNK env for drain runs. */
export const HIST_MAX_ENRICH_PER_CHUNK = Math.max(
  1,
  Math.min(100, Number(process.env.HIST_MAX_ENRICH_PER_CHUNK) || 20)
);
export const HIST_ENRICH_SLEEP_MS = 200;
/** Per AF enrich call timeout (events/stats/lineups). */
export const HIST_ENRICH_TIMEOUT_MS = 20_000;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type HistJobChunkResult = {
  leagueId: number;
  season: number;
  leagueName: string;
  status: string;
  inventoryFetched: number;
  finishedCount: number;
  enriched: number;
  skippedFull: number;
  goalsImported: number;
  statsImported: number;
  htFilled: number;
  cornersFilled: number;
  done: boolean;
  skipped: boolean;
  skipReason?: string;
  truncated: boolean;
  quotaAbort: boolean;
  error?: string;
};

function sortById(a: LiveApiFixture, b: LiveApiFixture): number {
  return (a.fixture?.id ?? 0) - (b.fixture?.id ?? 0);
}

async function confirmSeasonCoverage(
  leagueId: number,
  season: number
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const rows = await apiFootballGet<
      Array<{ league?: { id?: number; name?: string } }>
    >("/leagues", { id: leagueId, season });
    const hit = (rows ?? []).find((r) => r.league?.id === leagueId);
    if (!hit) {
      return {
        ok: false,
        reason: `no /leagues coverage for id=${leagueId} season=${season}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

function quotaTooLow(): boolean {
  const rem = getLastQuotaRemaining();
  return rem != null && rem < HIST_QUOTA_SAFETY_MARGIN;
}

/**
 * Process up to maxEnrich fixtures for one job.
 */
export async function processHistJobChunk(opts: {
  leagueId: number;
  season: number;
  leagueName: string;
  cursorFixtureId: number | null;
  maxEnrich: number;
  /** When true (pending jobs), confirm /leagues coverage first. */
  needsCoverageCheck?: boolean;
}): Promise<HistJobChunkResult> {
  const { leagueId, season, leagueName } = opts;
  const maxEnrich = Math.max(1, Math.min(HIST_MAX_ENRICH_PER_CHUNK, opts.maxEnrich));

  const base = {
    leagueId,
    season,
    leagueName,
    inventoryFetched: 0,
    finishedCount: 0,
    enriched: 0,
    skippedFull: 0,
    goalsImported: 0,
    statsImported: 0,
    htFilled: 0,
    cornersFilled: 0,
    done: false,
    skipped: false,
    truncated: false,
    quotaAbort: false,
  };

  if (opts.needsCoverageCheck !== false && (opts.cursorFixtureId == null || opts.cursorFixtureId === 0)) {
    console.info(`[hist] confirm coverage ${leagueName} ${season}`);
    const coverage = await confirmSeasonCoverage(leagueId, season);
    if (!coverage.ok) {
      await updateHistJob(leagueId, season, {
        status: "skipped",
        skipReason: coverage.reason ?? "no coverage",
        finishedAt: new Date(),
      });
      return {
        ...base,
        status: "skipped",
        skipped: true,
        skipReason: coverage.reason,
        done: true,
      };
    }
  }

  await updateHistJob(leagueId, season, {
    status: "in_progress",
    startedAt: new Date(),
    skipReason: null,
  });

  let raw: LiveApiFixture[] = [];
  try {
    console.info(`[hist] fetch season fixtures ${leagueName} ${season}`);
    raw = await withTimeout(
      apiSportsLiveProvider.fetchSeasonFixtures(leagueId, season),
      60_000,
      `season fixtures ${leagueId}/${season}`
    );
    console.info(`[hist] fetched ${raw.length} fixtures for ${leagueName} ${season}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateHistJob(leagueId, season, {
      status: "skipped",
      skipReason: msg,
      finishedAt: new Date(),
    });
    return {
      ...base,
      status: "skipped",
      skipped: true,
      skipReason: msg,
      done: true,
    };
  }

  const finished = raw
    .filter((f) =>
      isFinishedStatus((f.fixture?.status?.short ?? "").toUpperCase())
    )
    .sort(sortById);

  await updateHistJob(leagueId, season, {
    fixturesTotal: finished.length,
  });

  if (!finished.length) {
    await updateHistJob(leagueId, season, {
      status: "skipped",
      skipReason: "no finished fixtures",
      finishedAt: new Date(),
    });
    return {
      ...base,
      status: "skipped",
      inventoryFetched: raw.length,
      skipped: true,
      skipReason: "no finished fixtures",
      done: true,
    };
  }

  const cursor = opts.cursorFixtureId ?? 0;
  let enriched = 0;
  let skippedFull = 0;
  let goalsImported = 0;
  let statsImported = 0;
  let lastCursor = cursor;
  let truncated = false;
  let quotaAbort = false;

  for (const fx of finished) {
    const id = fx.fixture?.id;
    if (id == null) continue;
    if (id <= cursor) continue;

    if (quotaTooLow()) {
      quotaAbort = true;
      truncated = true;
      break;
    }
    if (enriched >= maxEnrich) {
      truncated = true;
      break;
    }

    const existing = await getHistFixture(id);
    if (existing?.dataCompleteness === "full") {
      skippedFull += 1;
      lastCursor = id;
      await updateHistJob(leagueId, season, { cursorFixtureId: id });
      continue;
    }

    const needGoals = !(existing && (await hasHistGoals(id)));
    const needStats = !(existing && (await hasHistStats(id)));
    const needLineups = !(existing && (await hasHistLineups(id)));

    let goalsOk = !needGoals;
    let statsOk = !needStats;
    let lineupsOk = !needLineups;

    try {
      console.info(`[hist] enrich fixture=${id} (${enriched + 1}/${maxEnrich})`);
      if (needGoals) {
        const events = await withTimeout(
          apiSportsLiveProvider.fetchEvents(id),
          HIST_ENRICH_TIMEOUT_MS,
          `events ${id}`
        );
        const goals = mapGoalEvents(id, events);
        goalsImported += await replaceHistGoals(id, goals);
        goalsOk = true;
        await sleep(HIST_ENRICH_SLEEP_MS);
      }
      if (quotaTooLow()) {
        quotaAbort = true;
      }
      if (!quotaAbort && needStats) {
        const statsRaw = await withTimeout(
          apiSportsLiveProvider.fetchStatistics(id),
          HIST_ENRICH_TIMEOUT_MS,
          `stats ${id}`
        );
        const stats = mapStatistics(id, statsRaw);
        statsImported += await replaceHistStats(id, stats);
        statsOk = stats.length > 0;
        await sleep(HIST_ENRICH_SLEEP_MS);
      }
      if (quotaTooLow()) {
        quotaAbort = true;
      }
      if (!quotaAbort && needLineups) {
        const lineupsRaw = await withTimeout(
          apiSportsLiveProvider.fetchLineups(id),
          HIST_ENRICH_TIMEOUT_MS,
          `lineups ${id}`
        );
        const lineups = mapLineups(id, lineupsRaw);
        await replaceHistLineups(id, lineups);
        lineupsOk = true;
        await sleep(HIST_ENRICH_SLEEP_MS);
      }
    } catch (e) {
      console.warn(
        `[hist] enrich failed fixture=${id}`,
        e instanceof Error ? e.message : e
      );
    }

    // Re-check DB for completeness after partial writes
    const hasG = goalsOk || (await hasHistGoals(id));
    const hasS = statsOk || (await hasHistStats(id));
    const hasL = lineupsOk || (await hasHistLineups(id));
    const f = fx as {
      score?: { halftime?: { home?: number | null; away?: number | null } };
      goals?: { home?: number | null; away?: number | null };
    };
    const hasHt =
      f.score?.halftime?.home != null && f.score?.halftime?.away != null;
    const hasFt = f.goals?.home != null && f.goals?.away != null;
    const completeness = inferCompleteness({
      hasGoals: hasG,
      hasStats: hasS,
      hasLineups: hasL,
      hasHt,
      hasFt,
    });

    const core = mapFixtureCore(fx, season, completeness);
    if (core) {
      await upsertHistTeams(mapTeamsFromFixture(fx, season));
      await upsertHistFixture(core);
    }

    enriched += 1;
    lastCursor = id;
    try {
      const imported = await countFixturesForLeagueSeason(leagueId, season);
      await updateHistJob(leagueId, season, {
        cursorFixtureId: id,
        fixturesImported: imported,
        goalsImported,
        statsImported,
      });
    } catch (e) {
      // Neon blips mid-chunk: keep cursor in memory; next chunk resumes.
      console.warn(
        `[hist] job cursor persist failed fixture=${id}`,
        e instanceof Error ? e.message : e
      );
    }

    if (quotaAbort) {
      truncated = true;
      break;
    }
  }

  const remaining = finished.filter((f) => {
    const id = f.fixture?.id;
    return id != null && id > lastCursor;
  });
  const jobDone = remaining.length === 0;

  if (jobDone) {
    await updateHistJob(leagueId, season, {
      status: "done",
      cursorFixtureId: lastCursor || null,
      fixturesImported: await countFixturesForLeagueSeason(leagueId, season),
      finishedAt: new Date(),
    });
    return {
      ...base,
      status: "done",
      inventoryFetched: raw.length,
      finishedCount: finished.length,
      enriched,
      skippedFull,
      goalsImported,
      statsImported,
      done: true,
      truncated,
      quotaAbort,
    };
  }

  await updateHistJob(leagueId, season, {
    status: "in_progress",
    cursorFixtureId: lastCursor || opts.cursorFixtureId,
    fixturesImported: await countFixturesForLeagueSeason(leagueId, season),
  });

  return {
    ...base,
    status: "in_progress",
    inventoryFetched: raw.length,
    finishedCount: finished.length,
    enriched,
    skippedFull,
    goalsImported,
    statsImported,
    done: false,
    truncated,
    quotaAbort,
  };
}

/**
 * Re-fetch HT scores and corner stats for fixtures already in inventory.
 */
export async function processHistEnrichmentChunk(opts: {
  leagueId: number;
  season: number;
  leagueName: string;
  maxEnrich: number;
}): Promise<HistJobChunkResult> {
  const { leagueId, season, leagueName } = opts;
  const maxEnrich = Math.max(
    1,
    Math.min(HIST_MAX_ENRICH_PER_CHUNK, opts.maxEnrich)
  );

  const base = {
    leagueId,
    season,
    leagueName,
    inventoryFetched: 0,
    finishedCount: 0,
    enriched: 0,
    skippedFull: 0,
    goalsImported: 0,
    statsImported: 0,
    htFilled: 0,
    cornersFilled: 0,
    done: false,
    skipped: false,
    truncated: false,
    quotaAbort: false,
  };

  await updateHistJob(leagueId, season, {
    status: "in_progress",
    skipReason: null,
  });

  const fixtureIds = await listFixturesNeedingEnrichment(
    leagueId,
    season,
    maxEnrich
  );

  if (!fixtureIds.length) {
    await updateHistJob(leagueId, season, {
      status: "done",
      finishedAt: new Date(),
    });
    return {
      ...base,
      status: "done",
      done: true,
    };
  }

  let enriched = 0;
  let htFilled = 0;
  let cornersFilled = 0;
  let goalsImported = 0;
  let statsImported = 0;
  let quotaAbort = false;

  for (const id of fixtureIds) {
    if (quotaTooLow()) {
      quotaAbort = true;
      break;
    }

    const before = await getHistFixtureEnrichmentState(id);
    if (!before.needsAny) {
      continue;
    }

    let fx: LiveApiFixture | null = null;
    try {
      fx = await withTimeout(
        apiSportsLiveProvider.fetchById(id),
        HIST_ENRICH_TIMEOUT_MS,
        `fixture ${id}`
      );
    } catch (e) {
      console.warn(
        `[hist] enrichment fetch fixture=${id}`,
        e instanceof Error ? e.message : e
      );
    }

    if (before.needsGoals && !quotaAbort) {
      try {
        const events = await withTimeout(
          apiSportsLiveProvider.fetchEvents(id),
          HIST_ENRICH_TIMEOUT_MS,
          `events ${id}`
        );
        goalsImported += await replaceHistGoals(id, mapGoalEvents(id, events));
        await sleep(HIST_ENRICH_SLEEP_MS);
      } catch (e) {
        console.warn(
          `[hist] enrichment events fixture=${id}`,
          e instanceof Error ? e.message : e
        );
      }
    }

    if (before.needsCorners && !quotaAbort) {
      try {
        const statsRaw = await withTimeout(
          apiSportsLiveProvider.fetchStatistics(id),
          HIST_ENRICH_TIMEOUT_MS,
          `stats ${id}`
        );
        const stats = mapStatistics(id, statsRaw);
        statsImported += await replaceHistStats(id, stats);
        await sleep(HIST_ENRICH_SLEEP_MS);
      } catch (e) {
        console.warn(
          `[hist] enrichment stats fixture=${id}`,
          e instanceof Error ? e.message : e
        );
      }
    }

    if (before.needsLineups && !quotaAbort) {
      try {
        const lineupsRaw = await withTimeout(
          apiSportsLiveProvider.fetchLineups(id),
          HIST_ENRICH_TIMEOUT_MS,
          `lineups ${id}`
        );
        await replaceHistLineups(id, mapLineups(id, lineupsRaw));
        await sleep(HIST_ENRICH_SLEEP_MS);
      } catch {
        // optional
      }
    }

    if (fx) {
      const f = fx as {
        score?: { halftime?: { home?: number | null; away?: number | null } };
        goals?: { home?: number | null; away?: number | null };
      };
      const hasG = (await hasHistGoals(id)) || before.needsGoals;
      const hasS = (await hasHistStats(id)) || before.needsCorners;
      const hasL = (await hasHistLineups(id)) || before.needsLineups;
      const hasHt =
        f.score?.halftime?.home != null && f.score?.halftime?.away != null;
      const hasFt = f.goals?.home != null && f.goals?.away != null;
      const hasCornersValue = await hasHistCorners(id);
      const completeness = inferCompleteness({
        hasGoals: hasG,
        hasStats: hasS,
        hasLineups: hasL,
        hasHt,
        hasFt,
        hasCornersValue,
      });
      const core = mapFixtureCore(fx, season, completeness);
      if (core) {
        await upsertHistTeams(mapTeamsFromFixture(fx, season));
        await upsertHistFixture(core);
      }
    }

    const after = await getHistFixtureEnrichmentState(id);
    if (before.needsHt && !after.needsHt) htFilled += 1;
    if (before.needsCorners && !after.needsCorners) cornersFilled += 1;
    enriched += 1;

    if (quotaTooLow()) {
      quotaAbort = true;
      break;
    }
  }

  const remaining = await listFixturesNeedingEnrichment(leagueId, season, 1);
  const jobDone = remaining.length === 0 && !quotaAbort;

  await updateHistJob(leagueId, season, {
    status: jobDone ? "done" : "in_progress",
    fixturesImported: await countFixturesForLeagueSeason(leagueId, season),
    goalsImported,
    statsImported,
    finishedAt: jobDone ? new Date() : null,
  });

  return {
    ...base,
    status: jobDone ? "done" : "in_progress",
    enriched,
    htFilled,
    cornersFilled,
    goalsImported,
    statsImported,
    done: jobDone,
    truncated: quotaAbort || fixtureIds.length >= maxEnrich,
    quotaAbort,
  };
}
