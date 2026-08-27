/**
 * Stamp system analysis predictions on Weekend Picks fixtures for AI Learner grading.
 * When live results sync into these batches, recomputeLearnerStats picks them up.
 */
import type { WeekendOpportunityRow } from "@/lib/match-centre/weekend-opportunities";
import type { CanonicalFixtureEstimate } from "./canonical-fixture-estimate";
import { mergeLiveDataIntoMatch } from "./sync-from-live-fixtures";
import type {
  LogMarketKey,
  LogMatch,
  MarketPrediction,
  PredictionBatch,
} from "./types";
import { TOTAL_GOALS_LINES } from "./total-goals-markets";
import type { MarketFamilyId } from "@/lib/slip-builder/types";
import { loadBatch, saveBatch } from "./club-store";

export type WeekendAnalysisSurfaceId =
  | "ladder"
  | "hsh"
  | "corners"
  | "total_goals"
  | "dieh"
  | "weekend_pick";

export type WeekendAnalysisSurfaceDef = {
  id: WeekendAnalysisSurfaceId;
  suffix: string;
  label: string;
};

export const WEEKEND_ANALYSIS_SURFACES: WeekendAnalysisSurfaceDef[] = [
  { id: "ladder", suffix: "LADDER", label: "Survival Ladder (2H>1H)" },
  { id: "hsh", suffix: "HSH", label: "Highest Scoring Half" },
  { id: "corners", suffix: "CORNERS", label: "Corners Analysis" },
  { id: "total_goals", suffix: "TOTAL-GOALS", label: "Total Goals Analysis" },
  { id: "dieh", suffix: "DIEH", label: "Draw Either Half" },
  { id: "weekend_pick", suffix: "BEST-PICK", label: "Weekend Best Pick" },
];

function pctConfidence(prob: number): number {
  return Math.round(Math.max(0, Math.min(100, prob * 100)));
}

function hshTopPick(est: CanonicalFixtureEstimate): MarketPrediction | null {
  const { p1h, p2h, pTie } = est.markets;
  const top = Math.max(p1h, p2h, pTie);
  if (!Number.isFinite(top)) return null;
  if (top === p2h) {
    return { prediction: "second_half", confidence: pctConfidence(p2h) };
  }
  if (top === p1h) {
    return { prediction: "first_half", confidence: pctConfidence(p1h) };
  }
  return { prediction: "equal", confidence: pctConfidence(pTie) };
}

function ladderPick(est: CanonicalFixtureEstimate): MarketPrediction | null {
  const p2hGt = est.markets.p2h_gt_1h;
  if (!Number.isFinite(p2hGt)) return null;
  return {
    prediction: "second_half",
    confidence: pctConfidence(p2hGt),
  };
}

function cornersPick(est: CanonicalFixtureEstimate): MarketPrediction | null {
  const over = est.markets.cornersOver95;
  const under = est.markets.cornersUnder95;
  if (!Number.isFinite(over) || !Number.isFinite(under)) return null;
  const pickOver = over >= under;
  return {
    prediction: pickOver ? "over" : "under",
    line: 9.5,
    confidence: pctConfidence(pickOver ? over : under),
  };
}

function totalGoalsPick(est: CanonicalFixtureEstimate): MarketPrediction | null {
  let best: { side: "over" | "under"; line: number; prob: number } | null = null;
  for (const line of TOTAL_GOALS_LINES) {
    const row = est.markets.totalGoals.lines[line];
    if (!row) continue;
    if (!best || row.over > best.prob) {
      best = { side: "over", line, prob: row.over };
    }
    if (!best || row.under > best.prob) {
      best = { side: "under", line, prob: row.under };
    }
  }
  if (!best) {
    const over = est.markets.over25;
    const under = est.markets.under25;
    if (!Number.isFinite(over)) return null;
    const pickOver = over >= under;
    return {
      prediction: pickOver ? "over" : "under",
      line: 2.5,
      confidence: pctConfidence(pickOver ? over : under),
    };
  }
  return {
    prediction: best.side,
    line: best.line,
    confidence: pctConfidence(best.prob),
  };
}

function diehPick(est: CanonicalFixtureEstimate): MarketPrediction | null {
  const d = est.markets.dieh;
  if (d.status !== "ok" || d.diehYes == null || d.diehNo == null) return null;
  const yes = d.diehYes >= d.diehNo;
  return {
    prediction: yes ? "yes" : "no",
    confidence: pctConfidence(yes ? d.diehYes : d.diehNo),
  };
}

function familyToMarketKey(family: MarketFamilyId): LogMarketKey | null {
  switch (family) {
    case "RESULT_1X2":
      return "1x2";
    case "DOUBLE_CHANCE":
      return "double_chance";
    case "HANDICAP":
      return "handicap";
    case "TOTALS":
      return "total_goals_ou";
    case "BTTS":
      return "btts";
    case "HALF_GOALS":
    case "HSH":
      return "more_goals_half";
    case "DIEH":
      return "draw_one_half";
    case "WIN_ONE_HALF":
      return "win_one_half";
    case "CORNERS":
      return "corners_ou";
    default:
      return null;
  }
}

function parseLineFromSelectionKey(sk: string): number | undefined {
  const tail = sk.match(/(\d+)_(\d+)$/);
  if (!tail) return undefined;
  return Number(`${tail[1]}.${tail[2]}`);
}

function parseWeekendPickPrediction(
  row: WeekendOpportunityRow
): { market: LogMarketKey; pred: MarketPrediction } | null {
  if (!row.trace.family || !row.trace.selectionKey) return null;
  const market = familyToMarketKey(row.trace.family);
  if (!market) return null;

  const sk = row.trace.selectionKey;
  let prediction = sk;
  let line = parseLineFromSelectionKey(sk);

  if (row.trace.family === "RESULT_1X2") {
    prediction = sk;
  } else if (row.trace.family === "DOUBLE_CHANCE") {
    prediction = sk.toLowerCase();
  } else if (row.trace.family === "HANDICAP") {
    const side = sk.startsWith("away") ? "away" : "home";
    prediction = side;
    line = row.trace.canonicalLine;
  } else if (row.trace.family === "TOTALS") {
    prediction = sk.startsWith("under") ? "under" : "over";
  } else if (row.trace.family === "BTTS") {
    prediction = sk;
  } else if (row.trace.family === "HSH" || row.trace.family === "HALF_GOALS") {
    if (sk === "2h_gt_1h") prediction = "second_half";
    else if (sk === "1h_gt_2h") prediction = "first_half";
    else if (sk === "tie") prediction = "equal";
  } else if (row.trace.family === "DIEH") {
    prediction = sk;
  } else if (row.trace.family === "WIN_ONE_HALF") {
    prediction = sk;
  } else if (row.trace.family === "CORNERS") {
    prediction = sk.startsWith("under") ? "under" : "over";
    line = 9.5;
  }

  return {
    market,
    pred: {
      prediction,
      line,
      confidence: pctConfidence(row.pRaw),
    },
  };
}

function pickForSurface(
  surface: WeekendAnalysisSurfaceId,
  est: CanonicalFixtureEstimate,
  weekendRow: WeekendOpportunityRow | undefined
): { market: LogMarketKey; pred: MarketPrediction } | null {
  switch (surface) {
    case "ladder": {
      const pred = ladderPick(est);
      return pred ? { market: "more_goals_half", pred } : null;
    }
    case "hsh": {
      const pred = hshTopPick(est);
      return pred ? { market: "more_goals_half", pred } : null;
    }
    case "corners": {
      const pred = cornersPick(est);
      return pred ? { market: "corners_ou", pred } : null;
    }
    case "total_goals": {
      const pred = totalGoalsPick(est);
      return pred ? { market: "total_goals_ou", pred } : null;
    }
    case "dieh": {
      const pred = diehPick(est);
      return pred ? { market: "draw_one_half", pred } : null;
    }
    case "weekend_pick": {
      if (!weekendRow) return null;
      return parseWeekendPickPrediction(weekendRow);
    }
  }
}

function estimateByMatchId(
  baseBatch: PredictionBatch,
  estimates: CanonicalFixtureEstimate[]
): Map<string, CanonicalFixtureEstimate> {
  const map = new Map<string, CanonicalFixtureEstimate>();
  for (let i = 0; i < baseBatch.matches.length; i++) {
    const est = estimates[i];
    const match = baseBatch.matches[i];
    if (est && match) map.set(match.id, est);
  }
  return map;
}

function weekendRowByFixtureId(
  rows: WeekendOpportunityRow[]
): Map<number, WeekendOpportunityRow> {
  const map = new Map<number, WeekendOpportunityRow>();
  for (const row of rows) {
    map.set(row.apiFixtureId, row);
  }
  return map;
}

function mergeExistingMatch(existing: LogMatch | undefined, next: LogMatch): LogMatch {
  if (!existing) return next;
  return {
    ...next,
    teamStats: existing.teamStats?.home?.goals != null ? existing.teamStats : next.teamStats,
    actualResults: Object.keys(existing.actualResults ?? {}).length
      ? existing.actualResults
      : next.actualResults,
    scored: Object.keys(existing.scored ?? {}).length ? existing.scored : next.scored,
    resultSource: existing.resultSource ?? next.resultSource,
    resultFilled: existing.resultFilled ?? next.resultFilled,
  };
}

/** Build learner batches — one surface per batch, one system pick per match. */
export function buildWeekendAnalysisLearnerBatches(input: {
  baseBatch: PredictionBatch;
  estimates: CanonicalFixtureEstimate[];
  weekendRows: WeekendOpportunityRow[];
  batchDate?: string;
}): PredictionBatch[] {
  const date = input.batchDate ?? input.baseBatch.date;
  const estMap = estimateByMatchId(input.baseBatch, input.estimates);
  const rowMap = weekendRowByFixtureId(input.weekendRows);
  const out: PredictionBatch[] = [];

  for (const surface of WEEKEND_ANALYSIS_SURFACES) {
    const id = `WEEKEND-${surface.suffix}-${date}`;
    const matches: LogMatch[] = [];

    for (const baseMatch of input.baseBatch.matches) {
      const est = estMap.get(baseMatch.id);
      if (!est) continue;
      const weekendRow =
        baseMatch.apiFixtureId != null
          ? rowMap.get(baseMatch.apiFixtureId)
          : undefined;
      const pick = pickForSurface(surface.id, est, weekendRow);
      if (!pick) continue;

      matches.push({
        ...baseMatch,
        id: `${id}-${baseMatch.id}`,
        predictions: { [pick.market]: pick.pred },
        actualResults: baseMatch.actualResults ?? {},
        scored: baseMatch.scored ?? {},
      });
    }

    if (matches.length === 0) continue;

    out.push({
      id,
      date,
      league: input.baseBatch.league,
      batchName: `Weekend ${surface.label}`,
      createdAt: new Date().toISOString(),
      batchKind: "manual",
      source: "web",
      matches,
    });
  }

  return out;
}

/** Persist analysis learner batches (merge existing FT results when present). */
export async function persistWeekendAnalysisLearnerBatches(input: {
  baseBatch: PredictionBatch;
  estimates: CanonicalFixtureEstimate[];
  weekendRows: WeekendOpportunityRow[];
}): Promise<{ saved: number; batchIds: string[] }> {
  const built = buildWeekendAnalysisLearnerBatches(input);
  const batchIds: string[] = [];

  for (const batch of built) {
    const existing = await loadBatch(batch.id);
    if (existing) {
      const byApiId = new Map(
        existing.matches
          .filter((m) => m.apiFixtureId != null)
          .map((m) => [m.apiFixtureId!, m])
      );
      batch.matches = batch.matches.map((m) => {
        const prev =
          m.apiFixtureId != null ? byApiId.get(m.apiFixtureId) : undefined;
        return mergeExistingMatch(prev, m);
      });
    }
    await saveBatch(batch);
    batchIds.push(batch.id);
  }

  return { saved: built.length, batchIds };
}

export function isWeekendAnalysisBatchId(batchId: string): boolean {
  return WEEKEND_ANALYSIS_SURFACES.some((s) =>
    batchId.startsWith(`WEEKEND-${s.suffix}-`)
  );
}

export function countWeekendAnalysisScoredPicks(
  batches: PredictionBatch[]
): { batches: number; scoredPicks: number } {
  let scoredPicks = 0;
  let batchCount = 0;
  for (const batch of batches) {
    if (!isWeekendAnalysisBatchId(batch.id)) continue;
    batchCount += 1;
    for (const match of batch.matches) {
      for (const result of Object.values(match.scored ?? {})) {
        if (result === "correct" || result === "wrong") scoredPicks += 1;
      }
    }
  }
  return { batches: batchCount, scoredPicks };
}
