/**
 * Prefer distribution-derived event % for binary DM markets when a score
 * grid (or corners model) is available. Complements stay coherent by construction.
 */
import { clampConfidence } from "./confidence";
import { eventProbPctFromScoreGrid } from "../goal-distribution";
import { poissonOverLine } from "../poisson-ou";
import type { CornersMatchPrediction } from "../corners-model";
import type { LogMatch, PredictionBatch } from "../types";
import type { DecisionBatchCaches, ScoredDecisionMarket } from "./types";

function findScoreGrid(
  batch: PredictionBatch,
  match: LogMatch
): number[][] | null {
  const rm = batch.recommended?.matches.find((m) => m.id === match.id);
  if (rm) {
    for (const pick of Object.values(rm.predictions)) {
      const grid = pick?.mathSnapshot?.statLayer?.scoreGrid;
      if (grid?.length) return grid;
    }
  }
  for (const pick of Object.values(match.predictions)) {
    const grid = (pick as { mathSnapshot?: { statLayer?: { scoreGrid?: number[][] } } })
      ?.mathSnapshot?.statLayer?.scoreGrid;
    if (grid?.length) return grid;
  }
  return null;
}

function cornersEventPct(
  prediction: string,
  corners: CornersMatchPrediction
): number {
  const isOver = /\bover\b/i.test(prediction);
  // Totals use 9.5 lean path; fall back to complementary pair
  const over = corners.pOver95;
  const under = corners.pUnder95;
  return (isOver ? over : under) * 100;
}

/** Rewrite binary market confidences from one distribution when possible. */
export function applyCoherentMarketConfidences(
  markets: ScoredDecisionMarket[],
  opts: {
    batch: PredictionBatch;
    match: LogMatch;
    caches: DecisionBatchCaches;
  }
): ScoredDecisionMarket[] {
  const grid = findScoreGrid(opts.batch, opts.match);
  const corners = opts.caches.cornersByMatchId.get(opts.match.id);

  return markets.map((m) => {
    if (m.marketKey === "corners_ou" && corners) {
      return {
        ...m,
        confidence: clampConfidence(cornersEventPct(m.prediction, corners)),
      };
    }
    if (m.marketKey === "home_corners_ou" && corners && m.line != null) {
      const over = poissonOverLine(m.line, corners.lambdaHome);
      const under = 1 - over;
      const isOver = /\bover\b/i.test(m.prediction);
      return {
        ...m,
        confidence: clampConfidence((isOver ? over : under) * 100),
      };
    }
    if (grid) {
      const pct = eventProbPctFromScoreGrid(
        m.marketKey,
        m.prediction,
        m.line,
        grid,
        opts.match.homeTeam,
        opts.match.awayTeam
      );
      if (pct != null) {
        return { ...m, confidence: clampConfidence(pct) };
      }
    }
    return m;
  });
}
