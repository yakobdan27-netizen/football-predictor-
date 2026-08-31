/**
 * Per-match API trace / enrich loop shared by batch-scoped and global sync.
 */
import { migrateMatchTraceState } from "@/lib/prediction-log/result-trace";
import { scoreMatch } from "@/lib/prediction-log/scoring";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { isWeekendBatchId } from "@/lib/prediction-log/weekend-analysis-learner";
import { isApiFootballKeyError, sleep } from "./client";
import { batchDateIsPastOrToday } from "./sync-batch-persist";
import { matchNeedsApiDetailFill } from "./map-fixture-to-match";
import {
  enrichMatchFromApi,
  traceMatchResult,
} from "./trace-fixture-by-pair";

export const DEFAULT_MAX_MATCHES_PER_PASS = 6;
export const WEEKEND_MAX_MATCHES_PER_PASS = 20;
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

export function batchFillPriority(batchId: string): number {
  if (/^WEEKEND-\d{4}-\d{2}-\d{2}$/.test(batchId)) return 0;
  if (isWeekendBatchId(batchId)) return 1;
  return 2;
}

/** Copy filled stats/trace from source; re-score target for its own predictions. */
export function propagateFillData(source: LogMatch, target: LogMatch): LogMatch {
  const merged: LogMatch = {
    ...target,
    apiFixtureId: target.apiFixtureId ?? source.apiFixtureId,
    fixtureStatus: source.fixtureStatus ?? target.fixtureStatus,
    resultSource: source.resultSource ?? target.resultSource,
    resultFilled: source.resultFilled ?? target.resultFilled,
    resultTraceState: source.resultTraceState ?? target.resultTraceState,
    resultTraceCheckedAt: source.resultTraceCheckedAt ?? target.resultTraceCheckedAt,
    resolvedHomeTeamName: source.resolvedHomeTeamName ?? target.resolvedHomeTeamName,
    resolvedAwayTeamName: source.resolvedAwayTeamName ?? target.resolvedAwayTeamName,
    traceNote: source.traceNote ?? target.traceNote,
    teamStats: source.teamStats ?? target.teamStats,
  };
  if (merged.teamStats?.home?.goals != null) {
    return scoreMatch(merged);
  }
  return merged;
}

function fixtureKey(match: LogMatch): string {
  if (match.apiFixtureId != null) return `api:${match.apiFixtureId}`;
  return `id:${match.id}`;
}

export type ApiFillFixtureGroup = {
  fixtureKey: string;
  items: ApiFillWorkItem[];
  priority: number;
};

export type ApiFillWorkItem = {
  batchId: string;
  batch: PredictionBatch;
  match: LogMatch;
  priority: number;
};

export function groupApiFillWorkByFixture(
  items: ApiFillWorkItem[]
): ApiFillFixtureGroup[] {
  const groups = new Map<string, ApiFillFixtureGroup>();
  for (const item of items) {
    const key = fixtureKey(item.match);
    let group = groups.get(key);
    if (!group) {
      group = {
        fixtureKey: key,
        items: [],
        priority: item.priority + batchFillPriority(item.batchId) * 10,
      };
      groups.set(key, group);
    }
    group.items.push(item);
    group.priority = Math.min(
      group.priority,
      item.priority + batchFillPriority(item.batchId) * 10
    );
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.priority - b.priority ||
      a.fixtureKey.localeCompare(b.fixtureKey)
  );
}

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
      batchFillPriority(a.batchId) - batchFillPriority(b.batchId) ||
      a.priority - b.priority ||
      a.batch.date.localeCompare(b.batch.date) ||
      a.match.id.localeCompare(b.match.id)
  );
  return items;
}

export function pendingWorkIsWeekendOnly(items: ApiFillWorkItem[]): boolean {
  if (items.length === 0) return false;
  return items.every((item) => isWeekendBatchId(item.batchId));
}

export function resolveMaxMatchesForWork(
  items: ApiFillWorkItem[],
  explicitMax?: number
): number {
  if (explicitMax != null) return explicitMax;
  return pendingWorkIsWeekendOnly(items)
    ? WEEKEND_MAX_MATCHES_PER_PASS
    : DEFAULT_MAX_MATCHES_PER_PASS;
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

  const groups = groupApiFillWorkByFixture(work);
  const maxMatches = resolveMaxMatchesForWork(work, opts?.maxMatches);
  const timeBudgetMs = opts?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const started = opts?.startedAt ?? Date.now();
  let processed = 0;

  for (const group of groups) {
    if (Date.now() - started > timeBudgetMs) {
      for (const item of group.items) summary.remaining.push(item.match.id);
      continue;
    }
    if (processed >= maxMatches) {
      for (const item of group.items) summary.remaining.push(item.match.id);
      continue;
    }

    processed += 1;

    const canonical =
      group.items.find((item) => /^WEEKEND-\d{4}-\d{2}-\d{2}$/.test(item.batchId)) ??
      group.items[0]!;

    let state = summary.updatedBatches.get(canonical.batchId);
    if (!state) {
      state = {
        batch: canonical.batch,
        byId: new Map(canonical.batch.matches.map((m) => [m.id, m])),
      };
      summary.updatedBatches.set(canonical.batchId, state);
    }

    const current = state.byId.get(canonical.match.id) ?? canonical.match;
    const result = await processOneMatchApiFill(current, state.batch);
    state.byId.set(canonical.match.id, result.match);
    summary.filled += result.filled;
    summary.enriched += result.enriched;
    summary.failed += result.failed;
    if (result.error) summary.errors.push(result.error);

    const filledMatch = result.match;
    for (const item of group.items) {
      if (item.match.id === canonical.match.id && item.batchId === canonical.batchId) {
        continue;
      }
      let itemState = summary.updatedBatches.get(item.batchId);
      if (!itemState) {
        itemState = {
          batch: item.batch,
          byId: new Map(item.batch.matches.map((m) => [m.id, m])),
        };
        summary.updatedBatches.set(item.batchId, itemState);
      }
      const itemCurrent = itemState.byId.get(item.match.id) ?? item.match;
      const propagated = propagateFillData(filledMatch, itemCurrent);
      itemState.byId.set(item.match.id, propagated);

      if (result.remaining && matchNeedsApiDetailFill(propagated)) {
        if (!summary.remaining.includes(item.match.id)) {
          summary.remaining.push(item.match.id);
        }
      }
    }

    if (result.unavailable) {
      summary.unavailable = true;
      for (const g of groups.slice(groups.indexOf(group))) {
        for (const item of g.items) {
          if (!summary.remaining.includes(item.match.id)) {
            summary.remaining.push(item.match.id);
          }
        }
      }
      break;
    }
    if (result.remaining) {
      for (const item of group.items) {
        const stateForBatch = summary.updatedBatches.get(item.batchId);
        const updated =
          stateForBatch?.byId.get(item.match.id) ?? item.match;
        if (
          matchNeedsApiDetailFill(updated) &&
          !summary.remaining.includes(item.match.id)
        ) {
          summary.remaining.push(item.match.id);
        }
      }
    }
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
