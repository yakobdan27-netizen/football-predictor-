/**
 * Helpers for Prediction Log name-pair result-trace state.
 */
import type {
  LogMatch,
  PredictionBatch,
  ResultTraceState,
} from "./types";

export const TRACE_ACTIVE_STATES: ReadonlySet<ResultTraceState> = new Set([
  "PENDING",
  "RETRY",
  "FOUND_NOT_FINAL",
]);

export const TRACE_REVIEW_STATES: ReadonlySet<ResultTraceState> = new Set([
  "AMBIGUOUS",
  "NEEDS_REVIEW",
]);

export function stampPendingTrace(match: LogMatch): LogMatch {
  return {
    ...match,
    resultFilled: false,
    resultTraceState: "PENDING",
    resultTraceCheckedAt: undefined,
    resolvedHomeTeamName: undefined,
    resolvedAwayTeamName: undefined,
    traceNote: undefined,
  };
}

export function stampPendingTraceOnBatch(batch: PredictionBatch): PredictionBatch {
  return {
    ...batch,
    matches: batch.matches.map((m) =>
      m.homeTeam?.trim() && m.awayTeam?.trim()
        ? stampPendingTrace(m)
        : m
    ),
  };
}

function matchLooksFilled(match: LogMatch): boolean {
  const hasFt =
    match.teamStats?.home?.goals != null &&
    match.teamStats?.away?.goals != null;
  if (hasFt && match.resultSource != null) return true;
  const scoredKeys = Object.keys(match.scored ?? {});
  if (scoredKeys.length === 0) return false;
  return scoredKeys.every((k) => {
    const r = match.scored[k as keyof typeof match.scored];
    return r === "correct" || r === "wrong" || r === "push" || r === "void";
  });
}

/** Infer trace state for legacy matches that lack resultTraceState. */
export function migrateMatchTraceState(match: LogMatch): LogMatch {
  if (match.resultTraceState) return match;
  if (matchLooksFilled(match)) {
    return {
      ...match,
      resultFilled: true,
      resultTraceState: "FILLED",
    };
  }
  return {
    ...match,
    resultFilled: false,
    resultTraceState: "PENDING",
  };
}

export function migrateBatchTraceStates(batch: PredictionBatch): PredictionBatch {
  return {
    ...batch,
    matches: batch.matches.map(migrateMatchTraceState),
  };
}

export function matchNeedsNamePairTrace(match: LogMatch): boolean {
  const m = migrateMatchTraceState(match);
  if (m.resultFilled || m.resultTraceState === "FILLED") return false;
  if (m.resultSource === "manual") {
    const hg = m.teamStats?.home?.goals;
    const ag = m.teamStats?.away?.goals;
    if (hg != null && ag != null) return false;
  }
  if (!m.homeTeam?.trim() || !m.awayTeam?.trim()) return false;
  if (TRACE_REVIEW_STATES.has(m.resultTraceState!)) return false;
  return TRACE_ACTIVE_STATES.has(m.resultTraceState!) || !m.apiFixtureId;
}

export type TraceStatusCounts = {
  pending: number;
  foundNotFinal: number;
  filled: number;
  ambiguous: number;
  needsReview: number;
  retry: number;
};

export function emptyTraceCounts(): TraceStatusCounts {
  return {
    pending: 0,
    foundNotFinal: 0,
    filled: 0,
    ambiguous: 0,
    needsReview: 0,
    retry: 0,
  };
}

export function accumulateTraceState(
  counts: TraceStatusCounts,
  state: ResultTraceState | undefined
): void {
  switch (state) {
    case "FOUND_NOT_FINAL":
      counts.foundNotFinal++;
      break;
    case "FILLED":
      counts.filled++;
      break;
    case "AMBIGUOUS":
      counts.ambiguous++;
      break;
    case "NEEDS_REVIEW":
      counts.needsReview++;
      break;
    case "RETRY":
      counts.retry++;
      break;
    case "PENDING":
    default:
      counts.pending++;
      break;
  }
}

export function countTraceStatusesAcrossBatches(
  batches: PredictionBatch[]
): TraceStatusCounts {
  const counts = emptyTraceCounts();
  for (const batch of batches) {
    for (const match of batch.matches) {
      if (!match.homeTeam?.trim() || !match.awayTeam?.trim()) continue;
      const m = migrateMatchTraceState(match);
      accumulateTraceState(counts, m.resultTraceState);
    }
  }
  return counts;
}

export function traceStateLabel(state: ResultTraceState | undefined): string {
  switch (state) {
    case "FOUND_NOT_FINAL":
      return "Match found — awaiting final result";
    case "FILLED":
      return "Filled";
    case "AMBIGUOUS":
      return "Needs review (ambiguous)";
    case "NEEDS_REVIEW":
      return "Needs review";
    case "RETRY":
      return "Pending API trace";
    case "PENDING":
    default:
      return "Pending API trace";
  }
}
