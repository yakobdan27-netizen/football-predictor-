/**
 * Persist win/loss at standard lines for every market leg on weekend pool fixtures.
 */
import { getDb } from "@/lib/db";
import {
  weekendMarketBttsHalvesResults,
  weekendMarketComboResults,
  weekendMarketCornerResults,
  weekendMarketDrawHalfResults,
  weekendMarketHalfGoalResults,
  weekendMarketStatsResults,
  weekendMarketTotalGoalsResults,
  weekendMarketWinResults,
} from "@/lib/db/schema";
import { scoreComboLeg } from "./combo-scoring";
import {
  DEFAULT_COMBO_MARKETS,
  EXTENDED_COMBO_FAMILY_IDS,
} from "./combo-markets-config";
import { deriveActualsFromFacts, gradeMatchFromFacts } from "./grade-from-facts";
import { matchLeague } from "./match-league";
import {
  LOG_MARKET_MAP,
  pickOptionsForMarket,
} from "./markets-config";
import { resolveMarketMode, singleMarketKey } from "./match-entry-helpers";
import { scoreMarket } from "./score-market";
import type { LogMarketKey, LogMatch, PredictionBatch, ScoreResult } from "./types";
import { isWeekendBaseBatchId } from "./weekend-analysis-learner";

export type MarketFamilyResult = "win" | "loss";

export type BaseMarketResultRow = {
  weekendBatchId: string;
  matchId: string;
  providerFixtureId: number | null;
  league: string | null;
  homeTeam: string;
  awayTeam: string;
  matchDate: string | null;
  selection: string;
  line: number | null;
  actualValue: string | null;
  result: MarketFamilyResult;
  wasWeekendPick: number;
};

export type CornerMarketResultRow = BaseMarketResultRow & {
  corners1hHome: number | null;
  corners1hAway: number | null;
  corners2hHome: number | null;
  corners2hAway: number | null;
};

export type WeekendMarketFamilyRows = {
  win: BaseMarketResultRow[];
  halfGoal: BaseMarketResultRow[];
  corner: CornerMarketResultRow[];
  combo: BaseMarketResultRow[];
  bttsHalves: BaseMarketResultRow[];
  drawHalf: BaseMarketResultRow[];
  totalGoals: BaseMarketResultRow[];
  stats: BaseMarketResultRow[];
};

const WIN_MARKET_KEYS: LogMarketKey[] = [
  "1x2",
  "double_chance",
  "win_one_half",
  "ht_1x2",
  "handicap",
  "ht_handicap",
  "three_way_handicap",
];

const STATS_MARKET_KEYS: LogMarketKey[] = [
  "shots_ou",
  "home_shots_ou",
  "away_shots_ou",
  "sot_ou",
  "home_sot_ou",
  "away_sot_ou",
  "throw_ins_ou",
  "offsides_ou",
];

const TOTAL_GOALS_MARKET_KEYS: LogMarketKey[] = [
  "home_goals_ou",
  "away_goals_ou",
  "total_goals_ou",
];

const CORNER_MARKET_KEYS: LogMarketKey[] = ["corners_ou", "home_corners_ou"];

const HALF_TOTAL_LINES = [0.5, 1.5] as const;

const COMBO_IDS = [
  ...new Set([
    ...DEFAULT_COMBO_MARKETS.filter((m) => m.enabled).map((m) => m.id),
    ...EXTENDED_COMBO_FAMILY_IDS,
  ]),
];

const COMBO_REQUIRES_HT = new Set(
  DEFAULT_COMBO_MARKETS.filter((m) => m.requiresHalfTime).map((m) => m.id)
);

function hasFtGoals(match: LogMatch): boolean {
  const hg = match.teamStats?.home?.goals;
  const ag = match.teamStats?.away?.goals;
  return hg != null && ag != null && Number.isFinite(hg) && Number.isFinite(ag);
}

function hasHtGoals(match: LogMatch): boolean {
  const hth = match.teamStats?.home?.firstHalfGoals;
  const ath = match.teamStats?.away?.firstHalfGoals;
  return (
    hth != null &&
    ath != null &&
    Number.isFinite(hth) &&
    Number.isFinite(ath)
  );
}

export function selectionKey(marketKey: string, prediction: string): string {
  return `${marketKey}:${prediction}`;
}

export function toWinLoss(result: ScoreResult): MarketFamilyResult | null {
  if (result === "correct") return "win";
  if (result === "wrong") return "loss";
  return null;
}

function fixtureKey(match: LogMatch): string | number {
  return match.apiFixtureId ?? `${match.homeTeam}|${match.awayTeam}`;
}

function pickLookupKey(
  match: LogMatch,
  selection: string,
  line: number | null
): string {
  return `${fixtureKey(match)}|${selection}|${line ?? ""}`;
}

/** Build lookup of surfaced portfolio / best-pick legs for was_weekend_pick. */
export function buildWeekendPickLookup(
  batches: PredictionBatch[],
  weekendDate: string
): Set<string> {
  const keys = new Set<string>();
  for (const batch of batches) {
    if (!batch.id.includes(weekendDate)) continue;
    const isPortfolio = batch.id.startsWith("WEEKEND-PORTFOLIO-");
    const isBestPick = batch.id.includes("-BEST-PICK-");
    if (!isPortfolio && !isBestPick) continue;

    for (const match of batch.matches) {
      if (match.comboPick?.comboId) {
        keys.add(pickLookupKey(match, match.comboPick.comboId, null));
        continue;
      }
      const mode = resolveMarketMode(match);
      if (mode === "combined") continue;
      const mk = singleMarketKey(match);
      const pred = mk ? match.predictions[mk] : undefined;
      if (!mk || !pred) continue;
      keys.add(pickLookupKey(match, selectionKey(mk, pred.prediction), pred.line ?? null));
    }
  }
  return keys;
}

function wasPick(
  match: LogMatch,
  selection: string,
  line: number | null,
  lookup: Set<string>
): number {
  return lookup.has(pickLookupKey(match, selection, line)) ? 1 : 0;
}

function baseRow(
  batch: PredictionBatch,
  match: LogMatch,
  selection: string,
  line: number | null,
  actualValue: string | null,
  result: MarketFamilyResult,
  lookup: Set<string>
): BaseMarketResultRow {
  return {
    weekendBatchId: batch.id,
    matchId: match.id,
    providerFixtureId: match.apiFixtureId ?? null,
    league: matchLeague(match, batch.league),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    matchDate: match.matchDate ?? batch.date,
    selection,
    line,
    actualValue,
    result,
    wasWeekendPick: wasPick(match, selection, line, lookup),
  };
}

function getNumericActual(
  marketKey: LogMarketKey | "away_corners_ou" | "match_1h_total" | "match_2h_total",
  actualResults: Partial<Record<LogMarketKey, { actual: string | number }>>,
  match: LogMatch
): number | null {
  const ts = match.teamStats;
  if (marketKey === "away_corners_ou") {
    const v = ts?.away?.corners;
    return v != null && Number.isFinite(v) ? v : null;
  }
  if (marketKey === "match_1h_total") {
    if (!hasHtGoals(match)) return null;
    return ts!.home!.firstHalfGoals! + ts!.away!.firstHalfGoals!;
  }
  if (marketKey === "match_2h_total") {
    if (!hasHtGoals(match) || !hasFtGoals(match)) return null;
    const hth = ts!.home!.firstHalfGoals!;
    const ath = ts!.away!.firstHalfGoals!;
    const hg = ts!.home!.goals!;
    const ag = ts!.away!.goals!;
    return hg - hth + (ag - ath);
  }
  const actual = actualResults[marketKey as LogMarketKey]?.actual;
  if (actual == null) return null;
  const n = typeof actual === "number" ? actual : parseFloat(String(actual));
  return Number.isFinite(n) ? n : null;
}

function gradeNumericOu(
  actual: number,
  line: number,
  prediction: "over" | "under"
): MarketFamilyResult | null {
  if (actual === line) return null;
  const side = actual > line ? "over" : "under";
  return side === prediction ? "win" : "loss";
}

function expandStandardMarketLegs(
  batch: PredictionBatch,
  match: LogMatch,
  marketKey: LogMarketKey,
  actualResults: Partial<Record<LogMarketKey, { actual: string | number }>>,
  lookup: Set<string>
): BaseMarketResultRow[] {
  const def = LOG_MARKET_MAP[marketKey];
  const rows: BaseMarketResultRow[] = [];

  if (
    def.kind === "numeric" ||
    def.kind === "asian_handicap" ||
    def.kind === "european_handicap"
  ) {
    const actual = getNumericActual(marketKey, actualResults, match);
    const lines = def.lineOptions ?? (def.defaultLine != null ? [def.defaultLine] : []);
    for (const line of lines) {
      if (def.kind === "numeric") {
        for (const side of ["over", "under"] as const) {
          if (actual == null) continue;
          const wl = gradeNumericOu(actual, line, side);
          if (wl == null) continue;
          const sel = selectionKey(marketKey, side);
          rows.push(
            baseRow(batch, match, sel, line, String(actual), wl, lookup)
          );
        }
      } else {
        for (const side of ["home", "away"] as const) {
          const raw = actualResults[marketKey]?.actual;
          const score = scoreMarket(marketKey, side, line, raw);
          const wl = toWinLoss(score);
          if (wl == null) continue;
          const sel = selectionKey(marketKey, side);
          rows.push(
            baseRow(
              batch,
              match,
              sel,
              line,
              raw != null ? String(raw) : null,
              wl,
              lookup
            )
          );
        }
      }
    }
    return rows;
  }

  const options = pickOptionsForMarket(marketKey, match.homeTeam, match.awayTeam);
  for (const opt of options) {
    const raw = actualResults[marketKey]?.actual;
    const score = scoreMarket(marketKey, opt.value, undefined, raw);
    const wl = toWinLoss(score);
    if (wl == null) continue;
    const sel = selectionKey(marketKey, opt.value);
    rows.push(
      baseRow(batch, match, sel, null, raw != null ? String(raw) : null, wl, lookup)
    );
  }
  return rows;
}

function expandAwayCornersLegs(
  batch: PredictionBatch,
  match: LogMatch,
  lookup: Set<string>
): BaseMarketResultRow[] {
  const actual = getNumericActual("away_corners_ou", {}, match);
  if (actual == null) return [];
  const def = LOG_MARKET_MAP.home_corners_ou;
  const lines = def.lineOptions ?? [def.defaultLine ?? 5.5];
  const rows: BaseMarketResultRow[] = [];
  for (const line of lines) {
    for (const side of ["over", "under"] as const) {
      const wl = gradeNumericOu(actual, line, side);
      if (wl == null) continue;
      const sel = selectionKey("away_corners_ou", side);
      rows.push(baseRow(batch, match, sel, line, String(actual), wl, lookup));
    }
  }
  return rows;
}

function expandHalfTotalLegs(
  batch: PredictionBatch,
  match: LogMatch,
  marketKey: "match_1h_total" | "match_2h_total",
  lookup: Set<string>
): BaseMarketResultRow[] {
  const actual = getNumericActual(marketKey, {}, match);
  if (actual == null) return [];
  const rows: BaseMarketResultRow[] = [];
  for (const line of HALF_TOTAL_LINES) {
    for (const side of ["over", "under"] as const) {
      const wl = gradeNumericOu(actual, line, side);
      if (wl == null) continue;
      const sel = selectionKey(marketKey, side);
      rows.push(baseRow(batch, match, sel, line, String(actual), wl, lookup));
    }
  }
  return rows;
}

function evaluateGoalBothHalves(match: LogMatch): boolean | null {
  if (!hasHtGoals(match) || !hasFtGoals(match)) return null;
  const ts = match.teamStats!;
  const fh = ts.home!.firstHalfGoals! + ts.away!.firstHalfGoals!;
  const sh =
    ts.home!.goals! -
    ts.home!.firstHalfGoals! +
    (ts.away!.goals! - ts.away!.firstHalfGoals!);
  return fh >= 1 && sh >= 1;
}

function expandTeamHalfComparison(
  batch: PredictionBatch,
  match: LogMatch,
  side: "home" | "away",
  lookup: Set<string>
): BaseMarketResultRow[] {
  if (!hasHtGoals(match) || !hasFtGoals(match)) return [];
  const ts = match.teamStats!;
  const g1 =
    side === "home" ? ts.home!.firstHalfGoals! : ts.away!.firstHalfGoals!;
  const g2 =
    side === "home"
      ? ts.home!.goals! - ts.home!.firstHalfGoals!
      : ts.away!.goals! - ts.away!.firstHalfGoals!;
  const key = side === "home" ? "home_2h_gt_1h" : "away_2h_gt_1h";
  const rows: BaseMarketResultRow[] = [];
  for (const pred of ["yes", "no"] as const) {
    const hit = g2 > g1;
    const wl: MarketFamilyResult = pred === "yes" ? (hit ? "win" : "loss") : hit ? "loss" : "win";
    const sel = selectionKey(key, pred);
    rows.push(
      baseRow(batch, match, sel, null, `1h=${g1},2h=${g2}`, wl, lookup)
    );
  }
  return rows;
}

function cornerSplitColumns(_match: LogMatch): {
  corners1hHome: number | null;
  corners1hAway: number | null;
  corners2hHome: number | null;
  corners2hAway: number | null;
} {
  return {
    corners1hHome: null,
    corners1hAway: null,
    corners2hHome: null,
    corners2hAway: null,
  };
}

/** Extract all family rows for one FT-complete pool match (pure — testable). */
export function extractWeekendMarketFamilyRows(
  batch: PredictionBatch,
  match: LogMatch,
  pickLookup: Set<string>
): WeekendMarketFamilyRows | null {
  if (!isWeekendBaseBatchId(batch.id)) return null;
  if (!hasFtGoals(match)) return null;

  const graded = gradeMatchFromFacts(match);
  const actualResults = {
    ...deriveActualsFromFacts(graded),
    ...graded.actualResults,
  };

  const win: BaseMarketResultRow[] = [];
  for (const mk of WIN_MARKET_KEYS) {
    if (mk === "ht_1x2" || mk === "ht_handicap" || mk === "win_one_half") {
      if (!hasHtGoals(match)) continue;
    }
    win.push(...expandStandardMarketLegs(batch, match, mk, actualResults, pickLookup));
  }

  const halfGoal: BaseMarketResultRow[] = [];
  if (hasHtGoals(match)) {
    halfGoal.push(
      ...expandStandardMarketLegs(
        batch,
        match,
        "more_goals_half",
        actualResults,
        pickLookup
      )
    );
    halfGoal.push(...expandTeamHalfComparison(batch, match, "home", pickLookup));
    halfGoal.push(...expandTeamHalfComparison(batch, match, "away", pickLookup));
  }

  const cornerSplits = cornerSplitColumns(match);
  const corner: CornerMarketResultRow[] = [];
  for (const mk of CORNER_MARKET_KEYS) {
    for (const row of expandStandardMarketLegs(
      batch,
      match,
      mk,
      actualResults,
      pickLookup
    )) {
      corner.push({ ...row, ...cornerSplits });
    }
  }
  for (const row of expandAwayCornersLegs(batch, match, pickLookup)) {
    corner.push({ ...row, ...cornerSplits });
  }

  const combo: BaseMarketResultRow[] = [];
  for (const comboId of COMBO_IDS) {
    if (COMBO_REQUIRES_HT.has(comboId) && !hasHtGoals(match)) continue;
    const score = scoreComboLeg(comboId, actualResults, graded.teamStats);
    const wl = toWinLoss(score);
    if (wl == null) continue;
    combo.push(baseRow(batch, match, comboId, null, null, wl, pickLookup));
  }

  const bttsHalves: BaseMarketResultRow[] = [];
  bttsHalves.push(
    ...expandStandardMarketLegs(batch, match, "btts", actualResults, pickLookup)
  );
  const gbh = evaluateGoalBothHalves(match);
  if (gbh != null) {
    for (const pred of ["yes", "no"] as const) {
      const wl: MarketFamilyResult =
        pred === "yes" ? (gbh ? "win" : "loss") : gbh ? "loss" : "win";
      bttsHalves.push(
        baseRow(
          batch,
          match,
          selectionKey("goal_both_halves", pred),
          null,
          gbh ? "yes" : "no",
          wl,
          pickLookup
        )
      );
    }
  }

  const drawHalf: BaseMarketResultRow[] = [];
  if (hasHtGoals(match)) {
    drawHalf.push(
      ...expandStandardMarketLegs(
        batch,
        match,
        "draw_one_half",
        actualResults,
        pickLookup
      )
    );
  }

  const totalGoals: BaseMarketResultRow[] = [];
  for (const mk of TOTAL_GOALS_MARKET_KEYS) {
    totalGoals.push(
      ...expandStandardMarketLegs(batch, match, mk, actualResults, pickLookup)
    );
  }
  if (hasHtGoals(match)) {
    totalGoals.push(...expandHalfTotalLegs(batch, match, "match_1h_total", pickLookup));
    totalGoals.push(...expandHalfTotalLegs(batch, match, "match_2h_total", pickLookup));
  }

  const stats: BaseMarketResultRow[] = [];
  for (const mk of STATS_MARKET_KEYS) {
    stats.push(
      ...expandStandardMarketLegs(batch, match, mk, actualResults, pickLookup)
    );
  }

  return { win, halfGoal, corner, combo, bttsHalves, drawHalf, totalGoals, stats };
}

type WeekendMarketBaseTable =
  | typeof weekendMarketWinResults
  | typeof weekendMarketHalfGoalResults
  | typeof weekendMarketComboResults
  | typeof weekendMarketBttsHalvesResults
  | typeof weekendMarketDrawHalfResults
  | typeof weekendMarketTotalGoalsResults
  | typeof weekendMarketStatsResults;

async function upsertBaseRows(
  table: WeekendMarketBaseTable,
  rows: BaseMarketResultRow[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const db = await getDb();
  const now = new Date();
  for (const row of rows) {
    await db
      .insert(table)
      .values({ ...row, filledAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [
          table.weekendBatchId,
          table.matchId,
          table.selection,
          table.line,
        ],
        set: {
          providerFixtureId: row.providerFixtureId,
          league: row.league,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          matchDate: row.matchDate,
          actualValue: row.actualValue,
          result: row.result,
          wasWeekendPick: row.wasWeekendPick,
          updatedAt: now,
        },
      });
  }
  return rows.length;
}

async function upsertCornerRows(rows: CornerMarketResultRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = await getDb();
  const now = new Date();
  for (const row of rows) {
    await db
      .insert(weekendMarketCornerResults)
      .values({ ...row, filledAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [
          weekendMarketCornerResults.weekendBatchId,
          weekendMarketCornerResults.matchId,
          weekendMarketCornerResults.selection,
          weekendMarketCornerResults.line,
        ],
        set: {
          providerFixtureId: row.providerFixtureId,
          league: row.league,
          homeTeam: row.homeTeam,
          awayTeam: row.awayTeam,
          matchDate: row.matchDate,
          actualValue: row.actualValue,
          result: row.result,
          wasWeekendPick: row.wasWeekendPick,
          corners1hHome: row.corners1hHome,
          corners1hAway: row.corners1hAway,
          corners2hHome: row.corners2hHome,
          corners2hAway: row.corners2hAway,
          updatedAt: now,
        },
      });
  }
  return rows.length;
}

export type PersistWeekendMarketFamilySummary = {
  rowsByFamily: Record<keyof WeekendMarketFamilyRows, number>;
  batchesProcessed: number;
  matchesProcessed: number;
  errors: string[];
};

/** Persist market-family results for all weekend base pool batches. */
export async function persistWeekendMarketFamilyResults(
  batches: PredictionBatch[]
): Promise<PersistWeekendMarketFamilySummary> {
  const summary: PersistWeekendMarketFamilySummary = {
    rowsByFamily: {
      win: 0,
      halfGoal: 0,
      corner: 0,
      combo: 0,
      bttsHalves: 0,
      drawHalf: 0,
      totalGoals: 0,
      stats: 0,
    },
    batchesProcessed: 0,
    matchesProcessed: 0,
    errors: [],
  };

  const baseBatches = batches.filter((b) => isWeekendBaseBatchId(b.id));
  for (const batch of baseBatches) {
    const pickLookup = buildWeekendPickLookup(batches, batch.date);
    summary.batchesProcessed += 1;

    for (const match of batch.matches) {
      try {
        const rows = extractWeekendMarketFamilyRows(batch, match, pickLookup);
        if (!rows) continue;
        summary.matchesProcessed += 1;

        summary.rowsByFamily.win += await upsertBaseRows(weekendMarketWinResults, rows.win);
        summary.rowsByFamily.halfGoal += await upsertBaseRows(
          weekendMarketHalfGoalResults,
          rows.halfGoal
        );
        summary.rowsByFamily.corner += await upsertCornerRows(rows.corner);
        summary.rowsByFamily.combo += await upsertBaseRows(
          weekendMarketComboResults,
          rows.combo
        );
        summary.rowsByFamily.bttsHalves += await upsertBaseRows(
          weekendMarketBttsHalvesResults,
          rows.bttsHalves
        );
        summary.rowsByFamily.drawHalf += await upsertBaseRows(
          weekendMarketDrawHalfResults,
          rows.drawHalf
        );
        summary.rowsByFamily.totalGoals += await upsertBaseRows(
          weekendMarketTotalGoalsResults,
          rows.totalGoals
        );
        summary.rowsByFamily.stats += await upsertBaseRows(
          weekendMarketStatsResults,
          rows.stats
        );
      } catch (e) {
        summary.errors.push(
          `${batch.id} ${match.homeTeam} vs ${match.awayTeam}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }
  }

  return summary;
}

export type WeekendMarketResultCounts = Record<
  keyof WeekendMarketFamilyRows,
  number
>;

/** Count rows per family (for monitoring API). */
export async function countWeekendMarketResultsByFamily(): Promise<WeekendMarketResultCounts> {
  const db = await getDb();
  const [
    win,
    halfGoal,
    corner,
    combo,
    bttsHalves,
    drawHalf,
    totalGoals,
    stats,
  ] = await Promise.all([
    db.select({ id: weekendMarketWinResults.id }).from(weekendMarketWinResults),
    db
      .select({ id: weekendMarketHalfGoalResults.id })
      .from(weekendMarketHalfGoalResults),
    db.select({ id: weekendMarketCornerResults.id }).from(weekendMarketCornerResults),
    db.select({ id: weekendMarketComboResults.id }).from(weekendMarketComboResults),
    db
      .select({ id: weekendMarketBttsHalvesResults.id })
      .from(weekendMarketBttsHalvesResults),
    db
      .select({ id: weekendMarketDrawHalfResults.id })
      .from(weekendMarketDrawHalfResults),
    db
      .select({ id: weekendMarketTotalGoalsResults.id })
      .from(weekendMarketTotalGoalsResults),
    db.select({ id: weekendMarketStatsResults.id }).from(weekendMarketStatsResults),
  ]);
  return {
    win: win.length,
    halfGoal: halfGoal.length,
    corner: corner.length,
    combo: combo.length,
    bttsHalves: bttsHalves.length,
    drawHalf: drawHalf.length,
    totalGoals: totalGoals.length,
    stats: stats.length,
  };
}
