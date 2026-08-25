/**
 * Rich settlement gates for Saved Batches (FT + HT + corners + goal timings).
 */
import type {
  GoalTimingCurve,
  LogMatch,
  MatchGoalTiming,
  PredictionBatch,
} from "./types";

const TIMING_KEYS: (keyof GoalTimingCurve)[] = [
  "g0_15",
  "g16_30",
  "g31_45",
  "g46_60",
  "g61_75",
  "g76_90plus",
];

function isNonNegInt(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n >= 0 && Number.isInteger(n);
}

export function timingGoalsSum(
  goalTiming?: MatchGoalTiming | null
): number | null {
  const buckets = goalTiming?.timingBuckets;
  if (!buckets) return null;
  let sum = 0;
  for (const key of TIMING_KEYS) {
    const v = buckets[key];
    if (!isNonNegInt(v)) return null;
    sum += v;
  }
  return sum;
}

export function matchHalfTotals(match: LogMatch): {
  htTotal: number | null;
  h2Total: number | null;
} {
  const hg = match.teamStats?.home?.goals;
  const ag = match.teamStats?.away?.goals;
  const hth = match.teamStats?.home?.firstHalfGoals;
  const ath = match.teamStats?.away?.firstHalfGoals;
  if (
    !isNonNegInt(hg) ||
    !isNonNegInt(ag) ||
    !isNonNegInt(hth) ||
    !isNonNegInt(ath)
  ) {
    return { htTotal: null, h2Total: null };
  }
  const htTotal = hth + ath;
  const h2Total = hg - hth + (ag - ath);
  if (h2Total < 0) return { htTotal, h2Total: null };
  return { htTotal, h2Total };
}

export function timingBucketsComplete(
  goalTiming?: MatchGoalTiming | null
): boolean {
  const buckets = goalTiming?.timingBuckets;
  if (!buckets) return false;
  return TIMING_KEYS.every((k) => isNonNegInt(buckets[k]));
}

export function matchHasRichSettlement(match: LogMatch): boolean {
  const ts = match.teamStats;
  if (!ts) return false;

  const hg = ts.home?.goals;
  const ag = ts.away?.goals;
  const hth = ts.home?.firstHalfGoals;
  const ath = ts.away?.firstHalfGoals;
  const corH = ts.home?.corners;
  const corA = ts.away?.corners;

  if (
    !isNonNegInt(hg) ||
    !isNonNegInt(ag) ||
    !isNonNegInt(hth) ||
    !isNonNegInt(ath) ||
    !isNonNegInt(corH) ||
    !isNonNegInt(corA)
  ) {
    return false;
  }

  if (!timingBucketsComplete(ts.goalTiming)) return false;

  const timingSum = timingGoalsSum(ts.goalTiming);
  if (timingSum == null) return false;
  return timingSum === hg + ag;
}

export function batchAllMatchesRichSettlement(batch: PredictionBatch): boolean {
  if (batch.matches.length === 0) return false;
  return batch.matches.every((m) => matchHasRichSettlement(m));
}

/** Stable fingerprint for auto-save dedupe. */
export function richSettlementFingerprint(batch: PredictionBatch): string {
  const parts = batch.matches.map((m) => {
    const ts = m.teamStats;
    const tb = ts?.goalTiming?.timingBuckets;
    return [
      m.id,
      ts?.home?.goals,
      ts?.away?.goals,
      ts?.home?.firstHalfGoals,
      ts?.away?.firstHalfGoals,
      ts?.home?.corners,
      ts?.away?.corners,
      tb?.g0_15,
      tb?.g16_30,
      tb?.g31_45,
      tb?.g46_60,
      tb?.g61_75,
      tb?.g76_90plus,
    ].join(":");
  });
  return `${batch.id}|${parts.join("|")}`;
}

export { TIMING_KEYS };
