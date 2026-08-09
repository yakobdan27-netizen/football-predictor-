"use client";

import { useMemo } from "react";
import {
  estimateBatchCanonical,
  type CanonicalFixtureEstimate,
} from "@/lib/prediction-log/canonical-fixture-estimate";
import type { TotalGoalsMarkets } from "@/lib/prediction-log/total-goals-markets";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import type { HalfParamsStore } from "@/lib/hist/half-params-types";

export type TotalGoalsRow = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  estimate: CanonicalFixtureEstimate;
  totalGoals: TotalGoalsMarkets;
  confidence: CanonicalFixtureEstimate["confidence_tier"];
};

export function useTotalGoalsPredictions(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[],
  halfParamsStore: HalfParamsStore | null
): {
  rows: TotalGoalsRow[];
  estimatesById: Record<string, CanonicalFixtureEstimate>;
} {
  return useMemo(() => {
    const empty: Record<string, CanonicalFixtureEstimate> = {};
    if (!batch) return { rows: [] as TotalGoalsRow[], estimatesById: empty };

    const estimates = estimateBatchCanonical(batch, allBatches, {
      halfParamsStore,
    });
    const byId: Record<string, CanonicalFixtureEstimate> = {};
    const rows: TotalGoalsRow[] = [];
    for (let i = 0; i < batch.matches.length; i++) {
      const match = batch.matches[i]!;
      const est = estimates[i]!;
      byId[match.id] = est;
      rows.push({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoff: match.matchDate ?? batch.date,
        estimate: est,
        totalGoals: est.markets.totalGoals,
        confidence: est.confidence_tier,
      });
    }
    return { rows, estimatesById: byId };
  }, [batch, allBatches, halfParamsStore]);
}
