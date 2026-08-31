/**
 * Stamp system analysis predictions on Weekend Picks fixtures for AI Learner grading.
 * When live results sync into these batches, recomputeLearnerStats picks them up.
 */
import type { PortfolioPick } from "@/lib/match-centre/weekend-portfolio";
import type { WeekendOpportunityRow } from "@/lib/match-centre/weekend-opportunities";
import { matchNeedsApiDetailFill } from "@/lib/football-api/map-fixture-to-match";
import type { CanonicalFixtureEstimate } from "./canonical-fixture-estimate";
import type {
  LogMarketKey,
  LogMatch,
  MarketPrediction,
  PredictionBatch,
} from "./types";
import { TOTAL_GOALS_LINES } from "./total-goals-markets";
import type { MarketFamilyId } from "@/lib/slip-builder/types";
import { loadBatch, saveBatch } from "./club-store";
import { scoreMatch } from "./scoring";

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
  const merged: LogMatch = {
    ...next,
    teamStats: existing.teamStats?.home?.goals != null ? existing.teamStats : next.teamStats,
    actualResults: Object.keys(existing.actualResults ?? {}).length
      ? existing.actualResults
      : next.actualResults,
    scored: Object.keys(existing.scored ?? {}).length ? existing.scored : next.scored,
    resultSource: existing.resultSource ?? next.resultSource,
    resultFilled: existing.resultFilled ?? next.resultFilled,
    resultTraceState: existing.resultTraceState ?? next.resultTraceState,
    resultTraceCheckedAt: existing.resultTraceCheckedAt ?? next.resultTraceCheckedAt,
    fixtureStatus: existing.fixtureStatus ?? next.fixtureStatus,
    resolvedHomeTeamName: existing.resolvedHomeTeamName ?? next.resolvedHomeTeamName,
    resolvedAwayTeamName: existing.resolvedAwayTeamName ?? next.resolvedAwayTeamName,
  };
  if (merged.teamStats?.home?.goals != null && Object.keys(merged.predictions).length) {
    return scoreMatch(merged);
  }
  return merged;
}

/** Union-merge: keep filled fixtures from existing batch even if absent from new build. */
export function unionMergeBatchMatches(
  existing: PredictionBatch | null,
  built: LogMatch[]
): LogMatch[] {
  const builtByApiId = new Map(
    built.filter((m) => m.apiFixtureId != null).map((m) => [m.apiFixtureId!, m])
  );
  const mergedBuilt = built.map((m) => {
    const prev =
      m.apiFixtureId != null ? existing?.matches.find((e) => e.apiFixtureId === m.apiFixtureId) : undefined;
    return mergeExistingMatch(prev, m);
  });
  if (!existing) return mergedBuilt;

  const keptFromExisting: LogMatch[] = [];
  for (const prev of existing.matches) {
    if (prev.apiFixtureId == null) continue;
    if (builtByApiId.has(prev.apiFixtureId)) continue;
    keptFromExisting.push(prev);
  }
  return [...mergedBuilt, ...keptFromExisting];
}

/** Base pool batch — all fixtures, no predictions (result-fill anchor). */
export function buildWeekendBaseBatch(baseBatch: PredictionBatch): PredictionBatch {
  const date = baseBatch.date;
  const id = weekendBaseBatchId(date);
  return {
    ...baseBatch,
    id,
    batchName: "Weekend Picks Pool",
    matches: baseBatch.matches.map((m, i) => ({
      ...m,
      id: `${id}-m${i + 1}`,
      predictions: {},
      actualResults: m.actualResults ?? {},
      scored: m.scored ?? {},
    })),
  };
}

export function weekendBaseBatchId(date: string): string {
  return `WEEKEND-${date}`;
}

export function weekendPortfolioBatchId(date: string): string {
  return `WEEKEND-PORTFOLIO-${date}`;
}

export function isWeekendBaseBatchId(batchId: string): boolean {
  return /^WEEKEND-\d{4}-\d{2}-\d{2}$/.test(batchId);
}

export function isWeekendPortfolioBatchId(batchId: string): boolean {
  return batchId.startsWith("WEEKEND-PORTFOLIO-");
}

function parsePortfolioPickPrediction(
  pick: PortfolioPick
): Pick<LogMatch, "predictions" | "comboPick" | "marketMode"> | null {
  const { trace, category } = pick;
  const confidence = pctConfidence(pick.pCalibrated || pick.pRaw);

  if (category === "combo" && trace.comboId) {
    return {
      predictions: {},
      comboPick: { comboId: trace.comboId, odds: 0 },
      marketMode: "combined",
    };
  }

  if (category === "goal_both_halves") {
    return {
      predictions: {},
      comboPick: { comboId: "goal_both_halves", odds: 0 },
      marketMode: "combined",
    };
  }

  if (!trace.family || !trace.selectionKey) return null;

  const sk = trace.selectionKey;
  let market: LogMarketKey | null = null;
  let prediction = sk;
  let line = trace.line ?? parseLineFromSelectionKey(sk);

  switch (category) {
    case "hsh_2h":
      market = "more_goals_half";
      prediction = "second_half";
      break;
    case "corners":
      market = "corners_ou";
      prediction = sk.startsWith("under") ? "under" : "over";
      line = line ?? 9.5;
      break;
    case "dieh":
      market = "draw_one_half";
      prediction = sk;
      break;
    case "totals":
      market = "total_goals_ou";
      prediction = sk.startsWith("under") ? "under" : "over";
      break;
    case "win_one_half":
      market = "win_one_half";
      prediction = sk;
      break;
    case "result_1x2":
      market = "1x2";
      prediction = sk;
      break;
    case "double_chance":
      market = "double_chance";
      prediction = sk.toLowerCase();
      break;
    case "team_corners_ou": {
      market = sk.startsWith("away_") ? "corners_ou" : "home_corners_ou";
      const dir = sk.includes("_under_") ? "under" : "over";
      prediction = dir;
      break;
    }
    default:
      return null;
  }

  if (!market) return null;
  return {
    predictions: {
      [market]: { prediction, line, confidence },
    },
    marketMode: "single",
  };
}

/** Portfolio batch — 24 curated picks for grading. */
export function buildWeekendPortfolioBatch(input: {
  picks: PortfolioPick[];
  baseBatch: PredictionBatch;
}): PredictionBatch | null {
  if (input.picks.length === 0) return null;
  const date = input.baseBatch.date;
  const id = weekendPortfolioBatchId(date);
  const baseByApiId = new Map(
    input.baseBatch.matches
      .filter((m) => m.apiFixtureId != null)
      .map((m) => [m.apiFixtureId!, m])
  );

  const matches: LogMatch[] = [];
  for (let i = 0; i < input.picks.length; i++) {
    const pick = input.picks[i]!;
    const base = baseByApiId.get(pick.apiFixtureId);
    const parsed = parsePortfolioPickPrediction(pick);
    if (!parsed) continue;

    matches.push({
      ...(base ?? {
        id: `${id}-m${i + 1}`,
        homeTeam: pick.homeTeam,
        awayTeam: pick.awayTeam,
        league: pick.league,
        matchDate: pick.kickoffIso.slice(0, 10),
        apiFixtureId: pick.apiFixtureId,
        fixtureStatus: "NS",
        actualResults: {},
        scored: {},
      }),
      id: `${id}-m${i + 1}`,
      predictions: parsed.predictions,
      comboPick: parsed.comboPick,
      marketMode: parsed.marketMode,
      actualResults: base?.actualResults ?? {},
      scored: base?.scored ?? {},
    });
  }

  if (matches.length === 0) return null;

  return {
    id,
    date,
    league: input.baseBatch.league,
    batchName: "Weekend Portfolio (24)",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    source: "web",
    matches,
  };
}

export type WeekendLearnerSyncResult = {
  saved: number;
  batchIds: string[];
  pendingFill: number;
  scoredPicks: number;
  error?: string;
};

function countPendingFillForBatches(batches: PredictionBatch[]): number {
  const pendingFixtures = new Set<number>();
  for (const batch of batches) {
    for (const match of batch.matches) {
      if (match.apiFixtureId == null) continue;
      if (matchNeedsApiDetailFill(match)) {
        pendingFixtures.add(match.apiFixtureId);
      }
    }
  }
  return pendingFixtures.size;
}

function countScoredPicksInBatches(batches: PredictionBatch[]): number {
  let scoredPicks = 0;
  for (const batch of batches) {
    for (const match of batch.matches) {
      for (const result of Object.values(match.scored ?? {})) {
        if (result === "correct" || result === "wrong") scoredPicks += 1;
      }
      if (match.comboPick && match.primaryGrade?.result) {
        const r = match.primaryGrade.result;
        if (r === "correct" || r === "wrong") scoredPicks += 1;
      }
    }
  }
  return scoredPicks;
}

async function persistBatchWithUnionMerge(batch: PredictionBatch): Promise<void> {
  const existing = await loadBatch(batch.id);
  batch.matches = unionMergeBatchMatches(existing, batch.matches);
  await saveBatch(batch);
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
  portfolioPicks?: PortfolioPick[];
}): Promise<WeekendLearnerSyncResult> {
  const batchIds: string[] = [];
  const savedBatches: PredictionBatch[] = [];

  const base = buildWeekendBaseBatch(input.baseBatch);
  await persistBatchWithUnionMerge(base);
  batchIds.push(base.id);
  savedBatches.push(base);

  const built = buildWeekendAnalysisLearnerBatches(input);
  for (const batch of built) {
    await persistBatchWithUnionMerge(batch);
    batchIds.push(batch.id);
    savedBatches.push(batch);
  }

  if (input.portfolioPicks?.length) {
    const portfolio = buildWeekendPortfolioBatch({
      picks: input.portfolioPicks,
      baseBatch: input.baseBatch,
    });
    if (portfolio) {
      await persistBatchWithUnionMerge(portfolio);
      batchIds.push(portfolio.id);
      savedBatches.push(portfolio);
    }
  }

  return {
    saved: savedBatches.length,
    batchIds,
    pendingFill: countPendingFillForBatches(savedBatches),
    scoredPicks: countScoredPicksInBatches(savedBatches),
  };
}

export function isWeekendAnalysisBatchId(batchId: string): boolean {
  if (isWeekendBaseBatchId(batchId) || isWeekendPortfolioBatchId(batchId)) {
    return true;
  }
  return WEEKEND_ANALYSIS_SURFACES.some((s) =>
    batchId.startsWith(`WEEKEND-${s.suffix}-`)
  );
}

export function isWeekendBatchId(batchId: string): boolean {
  return batchId.startsWith("WEEKEND-");
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
