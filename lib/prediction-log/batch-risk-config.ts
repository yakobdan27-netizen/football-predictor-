export type BatchRiskBand = "safe" | "caution" | "high";

export const BATCH_RISK_WEIGHTS = {
  totalOdds: 0.5,
  batchLoseHistory: 0.5,
} as const;

export const BATCH_RISK_BANDS = {
  safeMax: 40,
  cautionMax: 65,
} as const;

/** Upper bounds for combined-odds history buckets. */
export const TOTAL_ODDS_BUCKETS = [4, 8, 15, 30, Infinity] as const;

export const MIN_BATCH_HISTORY_SAMPLE = 3;

export const WEAK_MARKET_ACCURACY_THRESHOLD = 45;

export const LEG_WEAKNESS_WEIGHTS = {
  typeAccuracy: 0.35,
  h2hConfidence: 0.35,
  oddsInflation: 0.3,
} as const;

export const BATCH_LOSE_BLEND = {
  sizeLossRate: 0.6,
  weakTypeFactor: 0.4,
} as const;

export function batchRiskBand(score: number): BatchRiskBand {
  if (score <= BATCH_RISK_BANDS.safeMax) return "safe";
  if (score <= BATCH_RISK_BANDS.cautionMax) return "caution";
  return "high";
}

export function batchRiskBandLabel(band: BatchRiskBand): string {
  switch (band) {
    case "safe":
      return "Safe";
    case "caution":
      return "Caution";
    case "high":
      return "High Risk";
  }
}

export function oddsHistoryBucketIndex(combinedOdds: number): number {
  for (let i = 0; i < TOTAL_ODDS_BUCKETS.length; i++) {
    if (combinedOdds <= TOTAL_ODDS_BUCKETS[i]!) return i;
  }
  return TOTAL_ODDS_BUCKETS.length - 1;
}

export function oddsHistoryBucketLabel(combinedOdds: number): string {
  const idx = oddsHistoryBucketIndex(combinedOdds);
  const upper = TOTAL_ODDS_BUCKETS[idx]!;
  if (idx === 0) return `≤ ${upper}`;
  const lower = TOTAL_ODDS_BUCKETS[idx - 1]!;
  if (!Number.isFinite(upper)) return `> ${lower}`;
  return `${lower + 0.01}–${upper}`;
}
