import {
  normalizeApiTeamName,
  matchPairKey,
} from "@/lib/football-api/team-resolve";
import { loadAllBatches, saveBatch } from "./club-store";
import {
  applyGoalsToActuals,
  applyHalfTimeGoalsToActuals,
} from "./goal-result-sync";
import { cloneMatchTeamStats } from "./match-learning";
import type { ManualResultRecord } from "./manual-results-types";
import {
  batchNeedsResults,
  marketsEnteredCount,
  scoreBatch,
  scoreMatch,
} from "./scoring";
import { applyTeamStatsSync } from "./team-stats-sync";
import type { LogMatch, PredictionBatch } from "./types";

function normPairKey(home: string, away: string): string {
  return matchPairKey(normalizeApiTeamName(home), normalizeApiTeamName(away));
}

function bothGoals(
  home?: number | null,
  away?: number | null
): boolean {
  return (
    home != null &&
    away != null &&
    Number.isFinite(home) &&
    Number.isFinite(away)
  );
}

/**
 * Order-insensitive team pair match. Prefers API team ids when both sides have them.
 */
export function teamsMatchPair(
  a: {
    homeTeam: string;
    awayTeam: string;
    homeApiTeamId?: number | null;
    awayApiTeamId?: number | null;
  },
  b: {
    homeTeam: string;
    awayTeam: string;
    homeApiTeamId?: number | null;
    awayApiTeamId?: number | null;
  }
): { match: boolean; homeIsBatchHome: boolean } {
  const aHomeId = a.homeApiTeamId ?? null;
  const aAwayId = a.awayApiTeamId ?? null;
  const bHomeId = b.homeApiTeamId ?? null;
  const bAwayId = b.awayApiTeamId ?? null;

  if (
    aHomeId != null &&
    aAwayId != null &&
    bHomeId != null &&
    bAwayId != null
  ) {
    if (aHomeId === bHomeId && aAwayId === bAwayId) {
      return { match: true, homeIsBatchHome: true };
    }
    if (aHomeId === bAwayId && aAwayId === bHomeId) {
      return { match: true, homeIsBatchHome: false };
    }
    return { match: false, homeIsBatchHome: true };
  }

  const aKey = normPairKey(a.homeTeam, a.awayTeam);
  const bKey = normPairKey(b.homeTeam, b.awayTeam);
  const bRev = normPairKey(b.awayTeam, b.homeTeam);
  if (aKey === bKey) return { match: true, homeIsBatchHome: true };
  if (aKey === bRev) return { match: true, homeIsBatchHome: false };
  return { match: false, homeIsBatchHome: true };
}

/**
 * True when FT goals are missing. False when API-settled or any FT already present
 * (no force-override in v1).
 */
export function matchIsManuallyFillable(match: LogMatch): boolean {
  const hg = match.teamStats?.home?.goals;
  const ag = match.teamStats?.away?.goals;
  if (bothGoals(hg, ag)) {
    if (match.resultSource === "api-football") return false;
    // No force-override: leave any existing FT alone (manual/livescore/etc.).
    return false;
  }
  return true;
}

export interface ManualScoreInput {
  ftHome: number;
  ftAway: number;
  htHome?: number | null;
  htAway?: number | null;
}

/**
 * Apply form FT/HT to a batch match (swap if orientations differ), score, mark manual.
 */
export function applyManualScoreToMatch(
  match: LogMatch,
  score: ManualScoreInput,
  opts: { homeIsBatchHome: boolean }
): LogMatch {
  const ftHome = opts.homeIsBatchHome ? score.ftHome : score.ftAway;
  const ftAway = opts.homeIsBatchHome ? score.ftAway : score.ftHome;
  const hasHt =
    score.htHome != null &&
    score.htAway != null &&
    Number.isFinite(score.htHome) &&
    Number.isFinite(score.htAway);
  const htHome = hasHt
    ? opts.homeIsBatchHome
      ? score.htHome!
      : score.htAway!
    : undefined;
  const htAway = hasHt
    ? opts.homeIsBatchHome
      ? score.htAway!
      : score.htHome!
    : undefined;

  const teamStats = cloneMatchTeamStats(match);
  teamStats.home = { ...teamStats.home, goals: ftHome };
  teamStats.away = { ...teamStats.away, goals: ftAway };
  if (hasHt) {
    teamStats.home = { ...teamStats.home, firstHalfGoals: htHome };
    teamStats.away = { ...teamStats.away, firstHalfGoals: htAway };
  }

  let next: LogMatch = {
    ...match,
    teamStats,
    resultSource: "manual",
  };

  const actualResults = hasHt
    ? applyHalfTimeGoalsToActuals(next, ftHome, ftAway, htHome!, htAway!, {
        overwrite: false,
      })
    : applyGoalsToActuals(next, ftHome, ftAway, { overwrite: false });

  next = { ...next, actualResults };
  next = applyTeamStatsSync(next);
  return scoreMatch(next);
}

export interface BackfillOptions {
  /** When true, include batches created after the original filledAt. */
  includeNewerBatches?: boolean;
}

export interface BackfillResult {
  batchesUpdated: number;
  matchLegsUpdated: number;
}

function settleIfComplete(batch: PredictionBatch): PredictionBatch {
  const entered = marketsEnteredCount(batch);
  if (entered.total > 0 && entered.scored === entered.total) {
    return {
      ...batch,
      recommendationStatus:
        batch.batchKind === "recommended" ? "SETTLED" : batch.recommendationStatus,
      settledAt:
        batch.batchKind === "recommended"
          ? new Date().toISOString()
          : batch.settledAt,
    };
  }
  return batch;
}

export async function backfillBatchesFromManualResult(
  record: ManualResultRecord,
  options: BackfillOptions = {}
): Promise<BackfillResult> {
  const includeNewer = options.includeNewerBatches === true;
  const batches = await loadAllBatches();
  let batchesUpdated = 0;
  let matchLegsUpdated = 0;

  const formSide = {
    homeTeam: record.homeTeam,
    awayTeam: record.awayTeam,
    homeApiTeamId: record.homeApiTeamId,
    awayApiTeamId: record.awayApiTeamId,
  };

  const score: ManualScoreInput = {
    ftHome: record.ftHome,
    ftAway: record.ftAway,
    htHome: record.htHome,
    htAway: record.htAway,
  };

  for (const batch of batches) {
    if (!includeNewer && batch.createdAt > record.filledAt) continue;
    if (!batchNeedsResults(batch)) continue;

    let changed = false;
    const updatedMatches: LogMatch[] = [];

    for (const match of batch.matches) {
      const pair = teamsMatchPair(formSide, {
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        homeApiTeamId: match.homeApiTeamId,
        awayApiTeamId: match.awayApiTeamId,
      });
      if (!pair.match || !matchIsManuallyFillable(match)) {
        updatedMatches.push(match);
        continue;
      }

      const before = JSON.stringify(match);
      const applied = applyManualScoreToMatch(match, score, {
        homeIsBatchHome: pair.homeIsBatchHome,
      });
      if (JSON.stringify(applied) !== before) {
        changed = true;
        matchLegsUpdated++;
      }
      updatedMatches.push(applied);
    }

    if (!changed) continue;

    let updatedBatch = scoreBatch({ ...batch, matches: updatedMatches });
    updatedBatch = settleIfComplete(updatedBatch);
    await saveBatch(updatedBatch);
    batchesUpdated++;
  }

  return { batchesUpdated, matchLegsUpdated };
}
