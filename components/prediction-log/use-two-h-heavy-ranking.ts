"use client";

import { useMemo } from "react";
import {
  estimateBatchCanonical,
  ladderRanksFromBatchEstimates,
  type CanonicalFixtureEstimate,
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
  estimatesById: Record<string, CanonicalFixtureEstimate>;
} {
  const { ranked, estimatesById } = useMemo(() => {
    const emptyEst: Record<string, CanonicalFixtureEstimate> = {};
    if (!batch) {
      return { ranked: [] as LadderRankResult[], estimatesById: emptyEst };
    }
    const estimates = estimateBatchCanonical(batch, allBatches);
    const byId: Record<string, CanonicalFixtureEstimate> = {};
    for (let i = 0; i < batch.matches.length; i++) {
      byId[batch.matches[i]!.id] = estimates[i]!;
    }
    return {
      ranked: ladderRanksFromBatchEstimates(estimates, batch, allBatches),
      estimatesById: byId,
    };
  }, [batch, allBatches]);

  const byId = useMemo(() => {
    const out: Record<string, LadderRankResult> = {};
    for (const r of ranked) out[r.matchId] = r;
    return out;
  }, [ranked]);

  return { byId, ranked, loading: false, estimatesById };
}

export { profileCacheKey } from "@/lib/prediction-log/two-h-heavy";
