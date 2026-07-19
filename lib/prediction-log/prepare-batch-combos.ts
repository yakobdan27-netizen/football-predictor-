/**
 * Ensure every batch fixture is represented for Combined Odds evaluation:
 * - shell RecommendedMatch for each LogMatch
 * - attach Dixon-Coles / seed score grids when missing
 */
import { scoreGridForMatch } from "./correct-score-freeze";
import { matchLeague } from "./match-league";
import { RECO_ENGINE_VERSION } from "./recommendation-config";
import { singleMarketKey, resolveMarketMode } from "./match-entry-helpers";
import type { ClubIndex, ClubRecord } from "./club-record-types";
import type {
  LogMarketKey,
  LogMatch,
  PredictionBatch,
  RecommendedBatch,
  RecommendedMatch,
  RecommendedPick,
} from "./types";

function emptyRecommendedSummary(matchCount: number): RecommendedBatch["summary"] {
  return {
    totalCombinedOdds: null,
    riskLevel: "medium",
    matchesIncluded: matchCount,
    matchesDropped: 0,
    summaryJudgment: "Combo view — all batch fixtures.",
    exclusions: [],
  };
}

function pickFromLogMatch(match: LogMatch): {
  marketKey: LogMarketKey;
  pick: RecommendedPick;
} | null {
  if (resolveMarketMode(match) === "combined" && match.comboPick?.comboId) {
    // Combos still need a grid-bearing pick; use 1x2 shell for grid attachment
    return {
      marketKey: "1x2",
      pick: {
        prediction: "home",
        confidence: match.comboPick.systemProbability ?? 50,
        odds: match.comboPick.odds,
        action: "keep",
        judgment: "Combo entry fixture",
        accepted: true,
      },
    };
  }
  const key = singleMarketKey(match);
  if (!key) {
    return {
      marketKey: "1x2",
      pick: {
        prediction: "home",
        confidence: 50,
        action: "keep",
        judgment: "Fixture shell for combo grids",
        accepted: true,
      },
    };
  }
  const pred = match.predictions[key]!;
  return {
    marketKey: key,
    pick: {
      prediction: pred.prediction || "home",
      confidence: pred.confidence ?? 50,
      odds: pred.odds,
      line: pred.line,
      action: "keep",
      judgment: "Batch fixture",
      accepted: true,
      original: pred,
    },
  };
}

function existingRecommendedMatch(
  batch: PredictionBatch,
  matchId: string
): RecommendedMatch | undefined {
  return batch.recommended?.matches.find((m) => m.id === matchId);
}

/** Build RecommendedMatch[] covering every LogMatch in the batch. */
export function buildRecommendedMatchesForAllFixtures(
  batch: PredictionBatch
): RecommendedMatch[] {
  return batch.matches.map((match) => {
    const existing = existingRecommendedMatch(batch, match.id);
    if (existing && Object.keys(existing.predictions).length > 0) {
      return existing;
    }
    const fromLog = pickFromLogMatch(match);
    if (!fromLog) {
      return {
        id: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        predictions: {},
      };
    }
    return {
      id: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      predictions: { [fromLog.marketKey]: fromLog.pick },
    };
  });
}

/**
 * Ensure batch.recommended exists and includes every fixture.
 * Preserves combo odds / picks / existing recommended metadata.
 */
export function ensureComboRecommendedShell(batch: PredictionBatch): PredictionBatch {
  if (!batch.matches.length) return batch;

  const matches = buildRecommendedMatchesForAllFixtures(batch);
  const prev = batch.recommended;

  const comboPickByMatch = { ...(prev?.comboPickByMatch ?? {}) };
  for (const m of batch.matches) {
    if (m.comboPick?.comboId && !comboPickByMatch[m.id]) {
      comboPickByMatch[m.id] = m.comboPick.comboId;
    }
  }

  const comboOddsByMatch = { ...(prev?.comboOddsByMatch ?? {}) };
  for (const m of batch.matches) {
    if (m.comboPick?.odds != null && comboOddsByMatch[m.id] == null) {
      comboOddsByMatch[m.id] = m.comboPick.odds;
    }
  }

  const recommended: RecommendedBatch = {
    displayName: prev?.displayName ?? `${batch.batchName} – Combos`,
    generatedAt: prev?.generatedAt ?? batch.createdAt,
    engineVersion: prev?.engineVersion ?? RECO_ENGINE_VERSION,
    tier: prev?.tier,
    matches,
    acceptAll: prev?.acceptAll ?? true,
    summary: prev?.summary ?? emptyRecommendedSummary(matches.length),
    gameList: prev?.gameList ?? [],
    learnerGenerated: prev?.learnerGenerated,
    learnerAdvice: prev?.learnerAdvice,
    mathSnapshot: prev?.mathSnapshot,
    comboOddsByMatch: Object.keys(comboOddsByMatch).length ? comboOddsByMatch : prev?.comboOddsByMatch,
    comboScoredByMatch: prev?.comboScoredByMatch,
    comboPickByMatch: Object.keys(comboPickByMatch).length ? comboPickByMatch : prev?.comboPickByMatch,
    comboAccumulatorWon: prev?.comboAccumulatorWon,
    alternativeSuggestionStats: prev?.alternativeSuggestionStats,
  };

  return { ...batch, recommended };
}

function attachGridToPick(
  pick: RecommendedPick,
  grid: number[][] | null
): RecommendedPick {
  if (!grid) return pick;
  const prev = pick.mathSnapshot;
  return {
    ...pick,
    mathSnapshot: {
      signals: prev?.signals ?? {
        capacityEdge: 50,
        recentForm: 50,
        headToHead: 50,
        yourAccuracy: 50,
        luckyNudge: 50,
      },
      reliability: prev?.reliability ?? {
        capacityEdge: 0.5,
        recentForm: 0.5,
        headToHead: 0.5,
        yourAccuracy: 0.5,
        luckyNudge: 0.5,
      },
      pSignal: prev?.pSignal ?? pick.pSignal ?? pick.confidence,
      oddsUsed: prev?.oddsUsed ?? pick.odds ?? null,
      concentrationIndex: prev?.concentrationIndex,
      leagueAdjust: prev?.leagueAdjust,
      statLayer: {
        pCustom: prev?.statLayer?.pCustom ?? pick.confidence,
        pStat: prev?.statLayer?.pStat ?? pick.confidence,
        pDc: prev?.statLayer?.pDc ?? pick.confidence,
        pMl: prev?.statLayer?.pMl ?? pick.confidence,
        scoreGrid: grid,
        lambdaHome: prev?.statLayer?.lambdaHome,
        lambdaAway: prev?.statLayer?.lambdaAway,
        calibrated: prev?.statLayer?.calibrated ?? false,
      },
    },
  };
}

function matchHasGrid(rm: RecommendedMatch): boolean {
  for (const pick of Object.values(rm.predictions)) {
    if (pick?.mathSnapshot?.statLayer?.scoreGrid) return true;
  }
  return false;
}

/**
 * Attach score grids to every recommended match that lacks one.
 * Uses correct-score freeze path (live meta or seed priors).
 */
export function attachComboScoreGrids(
  batch: PredictionBatch,
  clubRecords: Record<string, ClubRecord>,
  clubIndex: ClubIndex | null,
  allBatches: PredictionBatch[]
): PredictionBatch {
  const shelled = ensureComboRecommendedShell(batch);
  if (!shelled.recommended) return shelled;

  const matches = shelled.recommended.matches.map((rm) => {
    if (matchHasGrid(rm)) return rm;
    const logMatch = shelled.matches.find((m) => m.id === rm.id);
    if (!logMatch) return rm;
    const league = matchLeague(logMatch, shelled.league);
    const grid = scoreGridForMatch(logMatch, league, clubRecords, clubIndex, allBatches);
    if (!grid) return rm;

    const predictions = { ...rm.predictions };
    const keys = Object.keys(predictions) as LogMarketKey[];
    if (keys.length === 0) {
      predictions["1x2"] = attachGridToPick(
        {
          prediction: "home",
          confidence: 50,
          action: "keep",
          judgment: "Combo grid shell",
          accepted: true,
        },
        grid
      );
    } else {
      for (const key of keys) {
        const pick = predictions[key];
        if (pick) predictions[key] = attachGridToPick(pick, grid);
      }
    }
    return { ...rm, predictions };
  });

  return {
    ...shelled,
    recommended: { ...shelled.recommended, matches },
  };
}

export function batchEligibleForComboView(batch: PredictionBatch): boolean {
  return batch.matches.length > 0;
}
