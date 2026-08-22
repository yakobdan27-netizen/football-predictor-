/**
 * Per-match API trace / enrich loop shared by batch-scoped and global sync.
 */
import { migrateMatchTraceState } from "@/lib/prediction-log/result-trace";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { isApiFootballKeyError, sleep } from "./client";
import { batchDateIsPastOrToday } from "./sync-batch-persist";
import { matchNeedsApiDetailFill } from "./map-fixture-to-match";
import {
  enrichMatchFromApi,
  traceMatchResult,
} from "./trace-fixture-by-pair";

export const DEFAULT_MAX_MATCHES_PER_PASS = 6;
export const DEFAULT_TIME_BUDGET_MS = 50_000;

export type ApiFillMatchResult = {
  match: LogMatch;
  filled: number;
  enriched: number;
  failed: number;
  remaining: boolean;
  error?: string;
  unavailable?: boolean;
};

function matchIsFilled(match: LogMatch): boolean {
  const m = migrateMatchTraceState(match);
  return m.resultFilled === true || m.resultTraceState === "FILLED";
}

export function matchFillPriority(match: LogMatch): number {
  const m = migrateMatchTraceState(match);
  if (m.resultTraceState === "FOUND_NOT_FINAL") return 0;
  if (!matchIsFilled(m)) return 1;
  if (m.teamStats?.home?.goals == null || m.teamStats?.away?.goals == null) return 2;
  return 3;
}

export async function processOneMatchApiFill(
  match: LogMatch,
  batch: PredictionBatch
): Promise<ApiFillMatchResult> {
  const current = migrateMatchTraceState(match);
  try {
    if (matchIsFilled(current)) {
      const result = await enrichMatchFromApi(current, batch);
      await sleep(100);
      return {
        match: result.match,
        filled: 0,
        enriched: result.enriched ? 1 : 0,
        failed: 0,
        remaining: !result.enriched && matchNeedsApiDetailFill(result.match),
      };
    }

    const traced = await traceMatchResult(current, batch);
    await sleep(100);
    let failed = 0;
    let remaining = false;
    if (traced.filled) {
      /* filled */
    } else if (traced.state === "RETRY" || traced.state === "FOUND_NOT_FINAL") {
      remaining = true;
    } else if (
      traced.state === "AMBIGUOUS" ||
      traced.state === "NEEDS_REVIEW"
    ) {
      failed = 1;
    } else if (matchNeedsApiDetailFill(traced.match)) {
      remaining = true;
    }

    return {
      match: traced.match,
      filled: traced.filled ? 1 : 0,
      enriched: 0,
      failed,
      remaining,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const unavailable =
      isApiFootballKeyError(msg) || /rate|limit|quota/i.test(msg);
    return {
      match: current,
      filled: 0,
      enriched: 0,
      failed: 1,
      remaining: true,
      error: `${match.homeTeam} vs ${match.awayTeam}: ${msg}`,
      unavailable,
    };
  }
}

export type ApiFillPassSummary = {
  filled: number;
  enriched: number;
  failed: number;
  remaining: string[];
  errors: string[];
  unavailable?: boolean;
  updatedBatches: Map<string, { batch: PredictionBatch; byId: Map<string, LogMatch> }>;
};

export type ApiFillWorkItem = {
  batchId: string;
  batch: PredictionBatch;
  match: LogMatch;
  priority: number;
};

export function collectApiFillWorkItems(
  batches: PredictionBatch[],
  opts?: { batchId?: string; matchIds?: Set<string> }
): ApiFillWorkItem[] {
  const items: ApiFillWorkItem[] = [];
  for (const batch of batches) {
    if (opts?.batchId && batch.id !== opts.batchId) continue;
    if (!batchDateIsPastOrToday(batch.date)) continue;
    for (const match of batch.matches) {
      if (opts?.matchIds && !opts.matchIds.has(match.id)) continue;
      if (!matchNeedsApiDetailFill(match)) continue;
      items.push({
        batchId: batch.id,
        batch,
        match,
        priority: matchFillPriority(match),
      });
    }
  }
  items.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.batch.date.localeCompare(b.batch.date) ||
      a.match.id.localeCompare(b.match.id)
  );
  return items;
}

export async function runApiFillPass(
  batches: PredictionBatch[],
  opts?: {
    batchId?: string;
    matchIds?: Set<string>;
    maxMatches?: number;
    timeBudgetMs?: number;
    startedAt?: number;
  }
): Promise<ApiFillPassSummary> {
  const summary: ApiFillPassSummary = {
    filled: 0,
    enriched: 0,
    failed: 0,
    remaining: [],
    errors: [],
    updatedBatches: new Map(),
  };

  const work = collectApiFillWorkItems(batches, {
    batchId: opts?.batchId,
    matchIds: opts?.matchIds,
  });
  if (!work.length) return summary;

  const maxMatches = opts?.maxMatches ?? DEFAULT_MAX_MATCHES_PER_PASS;
  const timeBudgetMs = opts?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const started = opts?.startedAt ?? Date.now();
  let processed = 0;

  for (const item of work) {
    if (Date.now() - started > timeBudgetMs) {
      summary.remaining.push(item.match.id);
      continue;
    }
    if (processed >= maxMatches) {
      summary.remaining.push(item.match.id);
      continue;
    }

    processed += 1;
    let state = summary.updatedBatches.get(item.batchId);
    if (!state) {
      state = {
        batch: item.batch,
        byId: new Map(item.batch.matches.map((m) => [m.id, m])),
      };
      summary.updatedBatches.set(item.batchId, state);
    }

    const current = state.byId.get(item.match.id) ?? item.match;
    const result = await processOneMatchApiFill(current, state.batch);
    state.byId.set(item.match.id, result.match);
    summary.filled += result.filled;
    summary.enriched += result.enriched;
    summary.failed += result.failed;
    if (result.error) summary.errors.push(result.error);
    if (result.unavailable) {
      summary.unavailable = true;
      summary.remaining.push(
        ...work.slice(work.indexOf(item)).map((w) => w.match.id)
      );
      break;
    }
    if (result.remaining) summary.remaining.push(item.match.id);
  }

  for (const item of work) {
    const state = summary.updatedBatches.get(item.batchId);
    const updated = state?.byId.get(item.match.id) ?? item.match;
    if (
      matchNeedsApiDetailFill(updated) &&
      !summary.remaining.includes(item.match.id)
    ) {
      summary.remaining.push(item.match.id);
    }
  }

  return summary;
}
