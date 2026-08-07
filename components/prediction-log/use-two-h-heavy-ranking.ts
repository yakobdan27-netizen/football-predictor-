"use client";

import { useMemo } from "react";
import { matchLeague } from "@/lib/prediction-log/match-league";
import {
  computeCanonicalHshPrediction,
  hshPredictionToLadderResult,
  compareCanonicalLadderDesc,
} from "@/lib/prediction-log/canonical-probability";
import {
  loadClubHalfAttackDefence,
  loadLeagueAfBaselines,
} from "@/lib/prediction-log/hsh-half-rates";
import { estimateTempoProfile } from "@/lib/prediction-log/half-tempo";
import type { TwoHHeavyResult } from "@/lib/prediction-log/two-h-heavy";
import type { BlendSource } from "@/lib/prediction-log/prediction-weights";
import type { PredictionBatch } from "@/lib/prediction-log/types";

export type LadderRankResult = TwoHHeavyResult & {
  sourceBreakdown: BlendSource;
  apiWeight: number;
  manualAiWeight: number;
};

/**
 * Ladder ranking from the canonical half engine (HSH Stage A/B).
 * Displayed P(2H>1H) matches Half-Time Ranking for the same fixture.
 * Does not call predictTwoHHeavy / computeHalfMus.
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

    const rows: LadderRankResult[] = batch.matches.map((match) => {
      const league = matchLeague(match, batch.league);
      const homeRates = loadClubHalfAttackDefence(match.homeTeam, league, allBatches, {
        beforeDate: batch.date,
      });
      const awayRates = loadClubHalfAttackDefence(match.awayTeam, league, allBatches, {
        beforeDate: batch.date,
      });
      const { lgAf1, lgAf2 } = loadLeagueAfBaselines(league);
      const homeTempo = estimateTempoProfile(allBatches, match.homeTeam, {
        beforeDate: batch.date,
      });
      const awayTempo = estimateTempoProfile(allBatches, match.awayTeam, {
        beforeDate: batch.date,
      });
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
      });
      return hshPredictionToLadderResult(pred);
    });

    return [...rows].sort(compareCanonicalLadderDesc);
  }, [batch, allBatches]);

  const byId = useMemo(() => {
    const out: Record<string, LadderRankResult> = {};
    for (const r of ranked) out[r.matchId] = r;
    return out;
  }, [ranked]);

  return { byId, ranked, loading: false };
}

export { profileCacheKey } from "@/lib/prediction-log/two-h-heavy";
