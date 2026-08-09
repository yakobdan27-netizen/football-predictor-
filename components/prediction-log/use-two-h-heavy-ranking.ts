"use client";

import { useMemo } from "react";
import {
  estimateBatchCanonical,
  ladderRanksFromBatchEstimates,
  type LadderRankFromCfe,
} from "@/lib/prediction-log/canonical-fixture-estimate";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export type LadderRankResult = LadderRankFromCfe;

/**
 * Ladder ranking from canonicalFixtureEstimate (batch SoT).
 * Displayed P(2H>1H) matches Half-Time Ranking for the same fixture.
 */
export function useTwoHHeavyRanking(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[],
  _opts?: { refreshToken?: number }
): {
  byId: Record<string, LadderRankResult>;
  ranked: LadderRankResult[];
  loading: boolean;
} {
  const ranked = useMemo(() => {
    if (!batch) return [] as LadderRankResult[];
    const estimates = estimateBatchCanonical(batch, allBatches);
    return ladderRanksFromBatchEstimates(estimates, batch, allBatches);
  }, [batch, allBatches]);

  const byId = useMemo(() => {
    const out: Record<string, LadderRankResult> = {};
    for (const r of ranked) out[r.matchId] = r;
    return out;
  }, [ranked]);

  return { byId, ranked, loading: false };
}

export { profileCacheKey } from "@/lib/prediction-log/two-h-heavy";
