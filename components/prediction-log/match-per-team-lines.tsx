"use client";

import { useMemo } from "react";
import { leanLabel, predictCornersMatch } from "@/lib/prediction-log/corners-model";
import { predictHighestScoringHalf } from "@/lib/prediction-log/hsh-model";
import {
  loadClubHalfAttackDefence,
  loadLeagueAfBaselines,
} from "@/lib/prediction-log/hsh-half-rates";
import { estimateTempoProfile } from "@/lib/prediction-log/half-tempo";
import { matchLeague } from "@/lib/prediction-log/match-league";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { PerTeamLinesPanel } from "./per-team-lines-panel";

/** Read-side per-team corner/HT lines for a single match (does not alter totals math). */
export function MatchPerTeamLines({
  match,
  batch,
  allBatches,
  compact = true,
}: {
  match: LogMatch;
  batch: PredictionBatch;
  allBatches: PredictionBatch[];
  compact?: boolean;
}) {
  const { corners, hsh } = useMemo(() => {
    const league = matchLeague(match, batch.league);
    const cornersPred = predictCornersMatch({
      matchId: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      league,
      batches: allBatches,
      beforeDate: batch.date,
    });
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
    const hshPred = predictHighestScoringHalf({
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
    return { corners: cornersPred, hsh: hshPred };
  }, [match, batch, allBatches]);

  const pct = (p: number) => `${Math.round(p * 100)}%`;

  return (
    <PerTeamLinesPanel
      compact={compact}
      cornersTotal={{
        text:
          corners.lean === "lean_none"
            ? `No lean · P(O9.5) ${pct(corners.pOver95)}`
            : `${leanLabel(corners.lean)} (${pct(corners.topProbability)})`,
        confidence: corners.confidence,
      }}
      corners={corners}
      hsh={hsh}
      showHtTotal
    />
  );
}
