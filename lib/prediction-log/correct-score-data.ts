import type { ClubRecord } from "./club-record-types";

/** Min club sample size (both sides) required for a correct-score prediction. */
export const CORRECT_SCORE_MIN_SAMPLE = 5;

export const CORRECT_SCORE_INSUFFICIENT_MESSAGE = "Not enough data to predict";

/** Prefer capacity.sampleSize; fall back to statMetadata.sample_size; missing → 0. */
export function clubSampleSize(record: ClubRecord | null | undefined): number {
  if (!record) return 0;
  const fromCapacity = record.capacity?.sampleSize;
  if (typeof fromCapacity === "number" && Number.isFinite(fromCapacity)) {
    return fromCapacity;
  }
  const fromMeta = record.statMetadata?.sample_size;
  if (typeof fromMeta === "number" && Number.isFinite(fromMeta)) {
    return fromMeta;
  }
  return 0;
}

export function correctScoreHasEnoughData(
  home: ClubRecord | null | undefined,
  away: ClubRecord | null | undefined
): boolean {
  return (
    clubSampleSize(home) >= CORRECT_SCORE_MIN_SAMPLE &&
    clubSampleSize(away) >= CORRECT_SCORE_MIN_SAMPLE
  );
}
