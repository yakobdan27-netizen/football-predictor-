/**
 * Resumable hist_* backfill chunk worker (cron + manual).
 */
import { ensureSchema } from "@/lib/db/init";
import {
  auditHistCoverage,
  gapQueueFromCoverage,
} from "./coverage-audit";
import { processHistJobChunk, HIST_MAX_ENRICH_PER_CHUNK } from "./import-job";
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
  truncated: boolean;
  quotaAbort: boolean;
  skippedJob: boolean;
  done: boolean;
  allJobsTerminal: boolean;
  gapPriority?: boolean;
  gapsRemaining?: number;
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
};

/**
 * Re-open terminal jobs that still have coverage gaps so gap-priority can drain them.
 */
async function reopenGapJobs(): Promise<number> {
  const report = await auditHistCoverage();
  const gaps = gapQueueFromCoverage(report);
  let reopened = 0;
  for (const g of gaps) {
    const job = await getHistJob(g.leagueId, g.season);
    if (!job) continue;
    if (job.status === "pending" || job.status === "in_progress") continue;
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

async function pickGapJob(): Promise<{
  leagueId: number;
  season: number;
  leagueName: string;
  cursorFixtureId: number | null;
  status: string;
} | null> {
  const report = await auditHistCoverage();
  const gaps = gapQueueFromCoverage(report);
  for (const g of gaps) {
    let job = await getHistJob(g.leagueId, g.season);
    if (!job) {
      await ensureHistJobs();
      job = await getHistJob(g.leagueId, g.season);
    }
    if (!job) continue;
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

export async function runHistBackfillChunk(
  opts?: HistBackfillOpts
): Promise<HistBackfillChunkSummary> {
  await ensureSchema();
  await ensureHistJobs();

  const gapPriority = opts?.gapPriority === true;
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
    truncated: false,
    quotaAbort: false,
    skippedJob: false,
    done: false,
    allJobsTerminal: false,
    gapPriority,
  };

  if (preflight.abort) {
    await updateHistMetaSummary(
      `chunk aborted: ${preflight.reason ?? "quota"}`
    );
    const summary = await histJobsSummary().catch(() => null);
    const gaps = gapPriority
      ? gapQueueFromCoverage(await auditHistCoverage()).length
      : undefined;
    return {
      ok: false,
      preflight,
      ...empty,
      gapsRemaining: gaps,
      allJobsTerminal: terminalAll(summary?.byStatus),
      progress: progressFrom(summary?.byStatus, summary?.fixtures),
      error: preflight.reason ?? "preflight abort",
      warning: "Quota/safety gate — resume later",
    };
  }

  if (gapPriority) {
    await reopenGapJobs();
  }

  const job = gapPriority
    ? await pickGapJob()
    : ((await listActiveHistJobs())[0] ?? null);

  if (!job) {
    const summary = await histJobsSummary();
    const coverage = await auditHistCoverage();
    const gapsLeft = gapQueueFromCoverage(coverage).length;
    await updateHistMetaSummary(
      gapPriority
        ? `gap queue empty (${coverage.summary.full}/${coverage.summary.total} full)`
        : "all hist jobs terminal"
    );
    return {
      ok: true,
      preflight,
      ...empty,
      done: true,
      allJobsTerminal: true,
      gapsRemaining: gapsLeft,
      progress: progressFrom(summary.byStatus, summary.fixtures),
      warning: gapPriority
        ? gapsLeft === 0
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
    const result = await processHistJobChunk({
      leagueId: job.leagueId,
      season: job.season,
      leagueName: job.leagueName,
      cursorFixtureId: job.cursorFixtureId,
      maxEnrich,
      needsCoverageCheck: job.status === "pending",
    });

    const summary = await histJobsSummary();
    const coverage = gapPriority ? await auditHistCoverage() : null;
    const gapsLeft = coverage
      ? gapQueueFromCoverage(coverage).length
      : undefined;
    const allJobsTerminal = terminalAll(summary.byStatus);
    const note = `${result.leagueName} ${result.season}: enriched=${result.enriched} status=${result.status}${gapPriority ? " [gap]" : ""}`;
    await updateHistMetaSummary(note);

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
      truncated: result.truncated,
      quotaAbort: result.quotaAbort,
      skippedJob: result.skipped,
      done: gapPriority ? (gapsLeft ?? 0) === 0 : allJobsTerminal,
      allJobsTerminal,
      gapPriority,
      gapsRemaining: gapsLeft,
      progress: progressFrom(summary.byStatus, summary.fixtures),
      warning: result.skipReason,
      error: result.error,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateHistMetaSummary(`chunk error: ${msg}`);
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
