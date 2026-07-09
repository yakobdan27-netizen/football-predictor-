import { isValidOdds } from "./odds-bands";
import {
  FINE_ODDS_BUCKET_WIDTH,
  MIN_SAMPLE_FOR_ACTION,
  WORST_ODDS_BUCKETS_COUNT,
} from "./recommendation-config";
import type { ScoredRow } from "./types";

export interface FineOddsBucketStats {
  bucket: string;
  wins: number;
  losses: number;
  pct: number | null;
  sample: number;
}

export function oddsToFineBucket(
  odds: number,
  width = FINE_ODDS_BUCKET_WIDTH
): string {
  if (!isValidOdds(odds)) return "unknown";
  const start = Math.floor(odds / width) * width;
  const end = Math.round((start + width) * 100) / 100;
  const startLabel = Math.round(start * 100) / 100;
  return `${startLabel.toFixed(2)}-${end.toFixed(2)}`;
}

export function computeFineOddsBuckets(rows: ScoredRow[]): Map<string, FineOddsBucketStats> {
  const map = new Map<string, { wins: number; losses: number }>();

  for (const row of rows) {
    if (row.odds == null || !isValidOdds(row.odds)) continue;
    if (row.result !== "correct" && row.result !== "wrong") continue;
    const bucket = oddsToFineBucket(row.odds);
    const cur = map.get(bucket) ?? { wins: 0, losses: 0 };
    if (row.result === "correct") cur.wins++;
    else cur.losses++;
    map.set(bucket, cur);
  }

  const result = new Map<string, FineOddsBucketStats>();
  for (const [bucket, stats] of map) {
    const sample = stats.wins + stats.losses;
    result.set(bucket, {
      bucket,
      wins: stats.wins,
      losses: stats.losses,
      sample,
      pct: sample > 0 ? Math.round((stats.wins / sample) * 100) : null,
    });
  }
  return result;
}

export function detectWorstOddsBuckets(
  buckets: Map<string, FineOddsBucketStats>,
  count = WORST_ODDS_BUCKETS_COUNT
): string[] {
  const eligible = [...buckets.values()].filter(
    (b) => b.sample >= MIN_SAMPLE_FOR_ACTION && b.pct != null
  );
  eligible.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
  return eligible.slice(0, count).map((b) => b.bucket);
}

export function isInWorstBucket(odds: number | undefined, worstBuckets: string[]): boolean {
  if (odds == null || !isValidOdds(odds) || worstBuckets.length === 0) return false;
  return worstBuckets.includes(oddsToFineBucket(odds));
}

export function fineBucketStats(
  buckets: Map<string, FineOddsBucketStats>,
  odds: number
): FineOddsBucketStats | null {
  if (!isValidOdds(odds)) return null;
  return buckets.get(oddsToFineBucket(odds)) ?? null;
}
