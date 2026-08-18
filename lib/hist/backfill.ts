/**
 * Resumable hist_* backfill chunk worker (cron + manual).
 */
import { ensureSchema } from "@/lib/db/init";
import {
  auditHistCoverage,
  enrichmentGapQueueFromCoverage,
  gapQueueFromCoverage,
  isProviderHoleReason as isProviderHoleSkip,
  type HistCoverageBucket,
} from "./coverage-audit";
import {
  processHistEnrichmentChunk,
  processHistJobChunk,
  HIST_MAX_ENRICH_PER_CHUNK,
} from "./import-job";
import {
  runHistPreflight,
  updateHistMetaSummary,
  type HistPreflight,
} from "./preflight";
import {
  ensureHistJobs,
  getHistJob,
  histJobsSummary,
  listActiveHistJobs,
  updateHistJob,
} from "./store";

export type HistBackfillChunkSummary = {
  ok: boolean;
  preflight: HistPreflight;
  leagueId: number | null;
  season: number | null;
  leagueName: string | null;
  status: string | null;
  inventoryFetched: number;
  finishedCount: number;
  enriched: number;
  skippedFull: number;
  goalsImported: number;
  statsImported: number;
  htFilled: number;
  cornersFilled: number;
  truncated: boolean;
  quotaAbort: boolean;
  skippedJob: boolean;
  done: boolean;
  allJobsTerminal: boolean;
  gapPriority?: boolean;
  mode?: "inventory" | "enrichment";
  gapsRemaining?: number;
  enrichmentGapsRemaining?: number;
  progress?: {
    pending: number;
    in_progress: number;
    done: number;
    skipped: number;
    fixtures: number;
  };
  error?: string;
  warning?: string;
};

export type HistBackfillOpts = {
  /** Prefer incomplete coverage buckets (missing → core-only → partial). */
  gapPriority?: boolean;
  /** When set, only drain buckets for this API league id. */
  leagueId?: number;
  /** Inventory fixture gaps (default) or HT/corners enrichment after gate pass. */
  mode?: "inventory" | "enrichment";
};

function filterGapsByLeague(
  gaps: HistCoverageBucket[],
  leagueId?: number
): HistCoverageBucket[] {
  if (leagueId == null) return gaps;
  return gaps.filter((g) => g.leagueId === leagueId);
}

function gapsForMode(
  report: Awaited<ReturnType<typeof auditHistCoverage>>,
  mode: "inventory" | "enrichment",
  leagueId?: number
): HistCoverageBucket[] {
  const queue =
    mode === "enrichment"
      ? enrichmentGapQueueFromCoverage(report)
      : gapQueueFromCoverage(report);
  return filterGapsByLeague(queue, leagueId);
}

/**
 * Re-open terminal jobs that still have coverage gaps so gap-priority can drain them.
 */
async function reopenGapJobs(
  report: Awaited<ReturnType<typeof auditHistCoverage>>,
  leagueId?: number
): Promise<number> {
  // Only reopen the next few queue heads — avoids 66 DB writes + Neon pressure per chunk.
  const gaps = filterGapsByLeague(gapQueueFromCoverage(report), leagueId).slice(
    0,
    8
  );
  let reopened = 0;
  for (const g of gaps) {
    const job = await getHistJob(g.leagueId, g.season);
    if (!job) continue;
    if (job.status === "pending" || job.status === "in_progress") continue;
    // Do not spin forever on seasons the provider cannot serve.
    if (job.status === "skipped" && isProviderHoleSkip(job.skipReason)) continue;
    await updateHistJob(g.leagueId, g.season, {
      status: "pending",
      cursorFixtureId: null,
      skipReason: `reopened for coverage=${g.completeness}`,
      finishedAt: null,
    });
    reopened += 1;
  }
  return reopened;
}

async function reopenEnrichmentJobs(
  report: Awaited<ReturnType<typeof auditHistCoverage>>,
  leagueId?: number
): Promise<number> {
  const gaps = filterGapsByLeague(
    enrichmentGapQueueFromCoverage(report),
    leagueId
  ).slice(0, 8);
  let reopened = 0;
  for (const g of gaps) {
    const job = await getHistJob(g.leagueId, g.season);
    if (!job) continue;
    if (job.status === "pending" || job.status === "in_progress") continue;
    if (job.status === "skipped" && isProviderHoleSkip(job.skipReason)) continue;
    await updateHistJob(g.leagueId, g.season, {
      status: "pending",
      skipReason: "reopened for ht/corners enrichment",
      finishedAt: null,
    });
    reopened += 1;
  }
  return reopened;
}

async function pickGapJob(
  report: Awaited<ReturnType<typeof auditHistCoverage>>,
  leagueId?: number
): Promise<{
  leagueId: number;
  season: number;
  leagueName: string;
  cursorFixtureId: number | null;
  status: string;
} | null> {
  const gaps = filterGapsByLeague(gapQueueFromCoverage(report), leagueId);
  for (const g of gaps) {
    let job = await getHistJob(g.leagueId, g.season);
    if (!job) {
      await ensureHistJobs();
      job = await getHistJob(g.leagueId, g.season);
    }
    if (!job) continue;
    if (job.status === "skipped" && isProviderHoleSkip(job.skipReason)) {
      continue;
    }
    if (job.status === "done" || job.status === "skipped") {
      await updateHistJob(g.leagueId, g.season, {
        status: "pending",
        cursorFixtureId: null,
        skipReason: `reopened for coverage=${g.completeness}`,
        finishedAt: null,
      });
      job = await getHistJob(g.leagueId, g.season);
    }
    if (!job) continue;
    return {
      leagueId: job.leagueId,
      season: job.season,
      leagueName: job.leagueName,
      cursorFixtureId: job.cursorFixtureId,
      status: job.status,
    };
  }
  return null;
}

async function pickEnrichmentGapJob(
  report: Awaited<ReturnType<typeof auditHistCoverage>>,
  leagueId?: number
): Promise<{
  leagueId: number;
  season: number;
  leagueName: string;
  cursorFixtureId: number | null;
  status: string;
} | null> {
  const gaps = filterGapsByLeague(
    enrichmentGapQueueFromCoverage(report),
    leagueId
  );
  for (const g of gaps) {
    let job = await getHistJob(g.leagueId, g.season);
    if (!job) {
      await ensureHistJobs();
      job = await getHistJob(g.leagueId, g.season);
    }
    if (!job) continue;
    if (job.status === "skipped" && isProviderHoleSkip(job.skipReason)) {
      continue;
    }
    if (job.status === "done" || job.status === "skipped") {
      await updateHistJob(g.leagueId, g.season, {
        status: "pending",
        skipReason: "reopened for ht/corners enrichment",
        finishedAt: null,
      });
      job = await getHistJob(g.leagueId, g.season);
    }
    if (!job) continue;
    return {
      leagueId: job.leagueId,
      season: job.season,
      leagueName: job.leagueName,
      cursorFixtureId: null as number | null,
      status: job.status,
    };
  }
  return null;
}

export async function runHistBackfillChunk(
  opts?: HistBackfillOpts
): Promise<HistBackfillChunkSummary> {
  await ensureSchema();
  await ensureHistJobs();

  const gapPriority = opts?.gapPriority === true;
  const leagueFilter = opts?.leagueId;
  const mode = opts?.mode ?? "inventory";
  const preflight = await runHistPreflight();
  const empty = {
    leagueId: null as number | null,
    season: null as number | null,
    leagueName: null as string | null,
    status: null as string | null,
    inventoryFetched: 0,
    finishedCount: 0,
    enriched: 0,
    skippedFull: 0,
    goalsImported: 0,
    statsImported: 0,
    htFilled: 0,
    cornersFilled: 0,
    truncated: false,
    quotaAbort: false,
    skippedJob: false,
    done: false,
    allJobsTerminal: false,
    gapPriority,
    mode,
  };

  if (preflight.abort) {
    await updateHistMetaSummary(
      `chunk aborted: ${preflight.reason ?? "quota"}`
    );
    const summary = await histJobsSummary().catch(() => null);
    const coverage = gapPriority ? await auditHistCoverage() : null;
    const gaps = coverage
      ? gapsForMode(coverage, mode, leagueFilter).length
      : undefined;
    const enrichGaps =
      coverage && mode === "enrichment"
        ? gapsForMode(coverage, "enrichment", leagueFilter).length
        : undefined;
    return {
      ok: false,
      preflight,
      ...empty,
      gapsRemaining: mode === "inventory" ? gaps : undefined,
      enrichmentGapsRemaining: enrichGaps ?? gaps,
      allJobsTerminal: terminalAll(summary?.byStatus),
      progress: progressFrom(summary?.byStatus, summary?.fixtures),
      error: preflight.reason ?? "preflight abort",
      warning: "Quota/safety gate — resume later",
    };
  }

  // One coverage audit per chunk (reopen + pick share it).
  const gapReport = gapPriority ? await auditHistCoverage() : null;
  if (gapReport) {
    if (mode === "enrichment") {
      await reopenEnrichmentJobs(gapReport, leagueFilter);
    } else {
      await reopenGapJobs(gapReport, leagueFilter);
    }
  }

  const job = gapPriority
    ? mode === "enrichment"
      ? await pickEnrichmentGapJob(gapReport!, leagueFilter)
      : await pickGapJob(gapReport!, leagueFilter)
    : ((await listActiveHistJobs())[0] ?? null);

  if (!job) {
    const summary = await histJobsSummary();
    const coverage = await auditHistCoverage();
    const gapsLeft = gapsForMode(coverage, "inventory", leagueFilter).length;
    const enrichLeft = gapsForMode(coverage, "enrichment", leagueFilter).length;
    await updateHistMetaSummary(
      gapPriority
        ? mode === "enrichment"
          ? `enrichment queue empty (${enrichLeft} gaps)`
          : `gap queue empty (${coverage.summary.full}/${coverage.summary.total} full)`
        : "all hist jobs terminal"
    );
    return {
      ok: true,
      preflight,
      ...empty,
      done: true,
      allJobsTerminal: true,
      gapsRemaining: gapsLeft,
      enrichmentGapsRemaining: enrichLeft,
      progress: progressFrom(summary.byStatus, summary.fixtures),
      warning: gapPriority
        ? mode === "enrichment"
          ? enrichLeft === 0
            ? "No enrichment gaps remaining"
            : "Enrichment jobs unavailable"
          : gapsLeft === 0
            ? "No coverage gaps remaining"
            : "Gap jobs unavailable"
        : "All hist jobs are done or skipped",
    };
  }

  const maxEnrich = Math.min(
    HIST_MAX_ENRICH_PER_CHUNK,
    Math.max(1, preflight.maxEnrichToday)
  );

  try {
    const result =
      mode === "enrichment"
        ? await processHistEnrichmentChunk({
            leagueId: job.leagueId,
            season: job.season,
            leagueName: job.leagueName,
            maxEnrich,
          })
        : await processHistJobChunk({
            leagueId: job.leagueId,
            season: job.season,
            leagueName: job.leagueName,
            cursorFixtureId: job.cursorFixtureId,
            maxEnrich,
            needsCoverageCheck: job.status === "pending",
          });

    let gapsLeft: number | undefined;
    let enrichLeft: number | undefined;
    let allJobsTerminal = false;
    let progress = progressFrom(undefined, undefined);
    try {
      const summary = await histJobsSummary();
      allJobsTerminal = terminalAll(summary.byStatus);
      progress = progressFrom(summary.byStatus, summary.fixtures);
      if (gapPriority) {
        const coverage = await auditHistCoverage();
        gapsLeft = gapsForMode(coverage, "inventory", leagueFilter).length;
        enrichLeft = gapsForMode(coverage, "enrichment", leagueFilter).length;
      }
    } catch (e) {
      console.warn(
        "[hist] post-chunk audit failed",
        e instanceof Error ? e.message : e
      );
    }
    const tag = gapPriority ? (mode === "enrichment" ? " [enrich]" : " [gap]") : "";
    const note = `${result.leagueName} ${result.season}: enriched=${result.enriched} ht=${result.htFilled} corners=${result.cornersFilled} status=${result.status}${tag}`;
    await updateHistMetaSummary(note).catch(() => undefined);

    const queueDone =
      mode === "enrichment"
        ? (enrichLeft ?? 0) === 0
        : (gapsLeft ?? 0) === 0;

    return {
      ok: true,
      preflight,
      leagueId: result.leagueId,
      season: result.season,
      leagueName: result.leagueName,
      status: result.status,
      inventoryFetched: result.inventoryFetched,
      finishedCount: result.finishedCount,
      enriched: result.enriched,
      skippedFull: result.skippedFull,
      goalsImported: result.goalsImported,
      statsImported: result.statsImported,
      htFilled: result.htFilled,
      cornersFilled: result.cornersFilled,
      truncated: result.truncated,
      quotaAbort: result.quotaAbort,
      skippedJob: result.skipped,
      done: gapPriority ? queueDone : allJobsTerminal,
      allJobsTerminal,
      gapPriority,
      mode,
      gapsRemaining: gapsLeft,
      enrichmentGapsRemaining: enrichLeft,
      progress,
      warning: result.skipReason,
      error: result.error,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateHistMetaSummary(`chunk error: ${msg}`).catch(() => undefined);
    return {
      ok: false,
      preflight,
      ...empty,
      leagueId: job.leagueId,
      season: job.season,
      leagueName: job.leagueName,
      status: job.status,
      error: msg,
    };
  }
}

function terminalAll(byStatus?: Record<string, number>): boolean {
  if (!byStatus) return false;
  const pending = byStatus.pending ?? 0;
  const inProg = byStatus.in_progress ?? 0;
  return pending === 0 && inProg === 0;
}

function progressFrom(
  byStatus?: Record<string, number>,
  fixtures?: number
) {
  return {
    pending: byStatus?.pending ?? 0,
    in_progress: byStatus?.in_progress ?? 0,
    done: byStatus?.done ?? 0,
    skipped: byStatus?.skipped ?? 0,
    fixtures: fixtures ?? 0,
  };
}
