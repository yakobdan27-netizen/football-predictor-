/**
 * Resumable hist_* backfill chunk worker (cron + manual).
 */
import { ensureSchema } from "@/lib/db/init";
import { processHistJobChunk, HIST_MAX_ENRICH_PER_CHUNK } from "./import-job";
import {
  runHistPreflight,
  updateHistMetaSummary,
  type HistPreflight,
} from "./preflight";
import {
  ensureHistJobs,
  histJobsSummary,
  listActiveHistJobs,
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

export async function runHistBackfillChunk(): Promise<HistBackfillChunkSummary> {
  await ensureSchema();
  await ensureHistJobs();

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
  };

  if (preflight.abort) {
    await updateHistMetaSummary(
      `chunk aborted: ${preflight.reason ?? "quota"}`
    );
    const summary = await histJobsSummary().catch(() => null);
    return {
      ok: false,
      preflight,
      ...empty,
      allJobsTerminal: terminalAll(summary?.byStatus),
      progress: progressFrom(summary?.byStatus, summary?.fixtures),
      error: preflight.reason ?? "preflight abort",
      warning: "Quota/safety gate — resume later",
    };
  }

  const active = await listActiveHistJobs();
  if (!active.length) {
    const summary = await histJobsSummary();
    await updateHistMetaSummary("all hist jobs terminal");
    return {
      ok: true,
      preflight,
      ...empty,
      done: true,
      allJobsTerminal: true,
      progress: progressFrom(summary.byStatus, summary.fixtures),
      warning: "All hist jobs are done or skipped",
    };
  }

  const job = active[0]!;
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
    const allJobsTerminal = terminalAll(summary.byStatus);
    const note = `${result.leagueName} ${result.season}: enriched=${result.enriched} status=${result.status}`;
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
      done: allJobsTerminal,
      allJobsTerminal,
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
