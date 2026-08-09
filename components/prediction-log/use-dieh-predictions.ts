"use client";

import { useMemo } from "react";
import {
  estimateBatchCanonical,
  type CanonicalFixtureEstimate,
} from "@/lib/prediction-log/canonical-fixture-estimate";
import type { DiehMarkets } from "@/lib/prediction-log/dieh-probability";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import type { HalfParamsStore } from "@/lib/hist/half-params-types";

export type DiehRow = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  estimate: CanonicalFixtureEstimate;
  dieh: DiehMarkets;
  confidence: CanonicalFixtureEstimate["confidence_tier"];
};

export function useDiehPredictions(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[],
  halfParamsStore: HalfParamsStore | null
): {
  rows: DiehRow[];
  estimatesById: Record<string, CanonicalFixtureEstimate>;
} {
  return useMemo(() => {
    const empty: Record<string, CanonicalFixtureEstimate> = {};
    if (!batch) return { rows: [] as DiehRow[], estimatesById: empty };

    const estimates = estimateBatchCanonical(batch, allBatches, {
      halfParamsStore,
    });
    const byId: Record<string, CanonicalFixtureEstimate> = {};
    const rows: DiehRow[] = [];
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
        dieh: est.markets.dieh,
        confidence: est.confidence_tier,
      });
    }
    return { rows, estimatesById: byId };
  }, [batch, allBatches, halfParamsStore]);
}
