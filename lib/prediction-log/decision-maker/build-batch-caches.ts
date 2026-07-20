import { evaluateBatchCombos } from "../combo-selection";
import { EXTENDED_COMBO_FAMILY_IDS } from "../combo-markets-config";
import {
  buildConcededMatchLog,
  predictConcededHalfMatch,
} from "../conceded-half-model";
import { predictCornersMatch } from "../corners-model";
import { estimateTempoProfile } from "../half-tempo";
import {
  loadClubHalfAttackDefence,
  loadLeagueAfBaselines,
} from "../hsh-half-rates";
import { predictHighestScoringHalf } from "../hsh-model";
import { matchLeague } from "../match-league";
import type {
  AnalysisHistory,
  CombinedOddsSettings,
  LearnerStatsStore,
  PredictionBatch,
} from "../types";
import type { TeamsQualityStore } from "../teams-quality-types";
import type { DecisionBatchCaches } from "./types";

const extendedComboFilter = (combo: { id: string }) =>
  EXTENDED_COMBO_FAMILY_IDS.includes(combo.id);

/**
 * Precompute published results from every model page for one batch.
 * Failures are swallowed per-model so remaining sources still feed decisions.
 */
export function buildDecisionBatchCaches(params: {
  batch: PredictionBatch;
  allBatches: PredictionBatch[];
  comboSettings: CombinedOddsSettings;
  analysis: AnalysisHistory | null;
  teamsQuality: TeamsQualityStore | null;
  learnerStats: LearnerStatsStore | null;
}): DecisionBatchCaches {
  const {
    batch,
    allBatches,
    comboSettings,
    analysis,
    teamsQuality,
    learnerStats,
  } = params;

  const caches: DecisionBatchCaches = {
    hshByMatchId: new Map(),
    cornersByMatchId: new Map(),
    concededByMatchId: new Map(),
    comboByMatchId: new Map(),
    comboExtendedByMatchId: new Map(),
  };

  try {
    for (const match of batch.matches) {
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
      caches.hshByMatchId.set(
        match.id,
        predictHighestScoringHalf({
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
        })
      );
    }
  } catch {
    /* keep empty — other sources continue */
  }

  try {
    for (const match of batch.matches) {
      caches.cornersByMatchId.set(
        match.id,
        predictCornersMatch({
          matchId: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          league: matchLeague(match, batch.league),
          batches: allBatches,
          beforeDate: batch.date,
        })
      );
    }
  } catch {
    /* keep empty */
  }

  try {
    const logRows = buildConcededMatchLog(allBatches);
    for (const match of batch.matches) {
      caches.concededByMatchId.set(
        match.id,
        predictConcededHalfMatch({
          matchId: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          league: matchLeague(match, batch.league),
          batches: allBatches,
          beforeDate: batch.date,
          logRows,
        })
      );
    }
  } catch {
    /* keep empty */
  }

  try {
    const { matches } = evaluateBatchCombos(
      batch,
      comboSettings,
      analysis,
      allBatches,
      teamsQuality,
      learnerStats,
      "balanced"
    );
    for (const row of matches) caches.comboByMatchId.set(row.matchId, row);
  } catch {
    /* keep empty */
  }

  try {
    const { matches } = evaluateBatchCombos(
      batch,
      comboSettings,
      analysis,
      allBatches,
      teamsQuality,
      learnerStats,
      "balanced",
      extendedComboFilter
    );
    for (const row of matches) caches.comboExtendedByMatchId.set(row.matchId, row);
  } catch {
    /* keep empty */
  }

  return caches;
}
