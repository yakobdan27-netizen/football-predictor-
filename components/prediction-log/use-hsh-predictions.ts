"use client";

import { useMemo } from "react";
import {
  estimateBatchCanonical,
  type CanonicalFixtureEstimate,
} from "@/lib/prediction-log/canonical-fixture-estimate";
import {
  computeCanonicalHshPrediction,
  canonicalProbabilityFromHsh,
} from "@/lib/prediction-log/canonical-probability";
import { matchLeague } from "@/lib/prediction-log/match-league";
import {
  loadClubHalfAttackDefence,
  loadLeagueAfBaselines,
} from "@/lib/prediction-log/hsh-half-rates";
import { estimateTempoProfile } from "@/lib/prediction-log/half-tempo";
import type { HshPrediction } from "@/lib/prediction-log/hsh-model";
import type { BlendSource } from "@/lib/prediction-log/prediction-weights";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import { useMatchCentreRatesCache } from "./use-match-centre-rates-cache";

export interface HshOverride {
  lambda1h?: number;
  lambda2h?: number;
}

export type HshPredictionWithBlend = HshPrediction & {
  sourceBreakdown: BlendSource;
  estimate?: CanonicalFixtureEstimate;
};

/**
 * Half-Time Ranking via canonicalFixtureEstimate markets (Stage B identity).
 * Manual λ overrides still go through computeCanonicalHshPrediction.
 */
export function useHshPredictions(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[],
  overrides: Record<string, HshOverride> = {}
): {
  predictions: HshPredictionWithBlend[];
  loading: boolean;
  error: string | null;
  estimatesById: Record<string, CanonicalFixtureEstimate>;
} {
  const matchCentreCache = useMatchCentreRatesCache(batch, allBatches);

  const { predictions, estimatesById } = useMemo(() => {
    const emptyEst: Record<string, CanonicalFixtureEstimate> = {};
    if (!batch) return { predictions: [] as HshPredictionWithBlend[], estimatesById: emptyEst };

    const estimates = estimateBatchCanonical(batch, allBatches, {
      matchCentreCache,
    });
    const byId: Record<string, CanonicalFixtureEstimate> = {};
    for (let i = 0; i < batch.matches.length; i++) {
      byId[batch.matches[i]!.id] = estimates[i]!;
    }

    const rateOpts = {
      beforeDate: batch.date,
      matchCentreCache,
    };

    const predictions = batch.matches.map((match, i) => {
      const league = matchLeague(match, batch.league);
      const homeRates = loadClubHalfAttackDefence(
        match.homeTeam,
        league,
        allBatches,
        rateOpts
      );
      const awayRates = loadClubHalfAttackDefence(
        match.awayTeam,
        league,
        allBatches,
        rateOpts
      );
      const { lgAf1, lgAf2 } = loadLeagueAfBaselines(league);
      const homeTempo = estimateTempoProfile(allBatches, match.homeTeam, {
        beforeDate: batch.date,
      });
      const awayTempo = estimateTempoProfile(allBatches, match.awayTeam, {
        beforeDate: batch.date,
      });
      const override = overrides[match.id];
      const est = estimates[i]!;

      const pred = computeCanonicalHshPrediction({
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        league,
        homeRates,
        awayRates,
        lgAf1,
        lgAf2,
        homeTempo,
        awayTempo,
        manualLambda1h: override?.lambda1h,
        manualLambda2h: override?.lambda2h,
      });

      if (!override?.lambda1h && !override?.lambda2h) {
        const aligned: HshPredictionWithBlend = {
          ...pred,
          p1h: est.markets.p1h,
          p2h: est.markets.p2h,
          pTie: est.markets.pTie,
          topProbability: Math.max(
            est.markets.p1h,
            est.markets.p2h,
            est.markets.pTie
          ),
          sourceBreakdown: est.provenance.sourceBreakdown,
          estimate: est,
        };
        return aligned;
      }

      const canon = canonicalProbabilityFromHsh(pred, "hsh_2h_gt_1h");
      return {
        ...pred,
        sourceBreakdown: canon.sourceBreakdown,
        estimate: est,
      };
    });

    return { predictions, estimatesById: byId };
  }, [batch, allBatches, overrides, matchCentreCache]);

  return { predictions, loading: false, error: null, estimatesById };
}
