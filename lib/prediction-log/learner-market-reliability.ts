/**
 * Aggregate team/market reliability from weekend per-market result tables.
 */
import { getDb } from "@/lib/db";
import {
  aiLearnerMarketReliability,
  weekendMarketBttsHalvesResults,
  weekendMarketComboResults,
  weekendMarketCornerResults,
  weekendMarketDrawHalfResults,
  weekendMarketHalfGoalResults,
  weekendMarketStatsResults,
  weekendMarketTotalGoalsResults,
  weekendMarketWinResults,
  type NewAiLearnerMarketReliability,
} from "@/lib/db/schema";
import type { PortfolioCategoryId } from "@/lib/match-centre/weekend-portfolio";
import type { ScoredLeg } from "@/lib/match-centre/weekend-opportunities";
import { LOG_MARKET_MAP } from "./markets-config";
import type { LogMarketKey, MarketReliabilityEntry } from "./types";
import type { BaseMarketResultRow } from "./weekend-market-results";
import { selectionKey } from "./weekend-market-results";

export const MIN_RELIABILITY_SAMPLE = 3;

export type WeekendMarketFamilyId =
  | "win"
  | "halfGoal"
  | "corner"
  | "combo"
  | "bttsHalves"
  | "drawHalf"
  | "totalGoals"
  | "stats";

export type MarketTableWinRow = BaseMarketResultRow & {
  marketFamily: WeekendMarketFamilyId;
};

export type PortfolioLegMapping = {
  marketFamily: WeekendMarketFamilyId;
  selection: string;
  line: number | null;
  teamSide: "home" | "away" | "match";
};

type RawMarketRow = {
  weekendBatchId: string;
  matchId: string;
  providerFixtureId: number | null;
  league: string | null;
  homeTeam: string;
  awayTeam: string;
  matchDate: string | null;
  selection: string;
  line: number | null;
  result: string;
};

const FAMILY_TABLES: Array<{
  family: WeekendMarketFamilyId;
  table:
    | typeof weekendMarketWinResults
    | typeof weekendMarketHalfGoalResults
    | typeof weekendMarketCornerResults
    | typeof weekendMarketComboResults
    | typeof weekendMarketBttsHalvesResults
    | typeof weekendMarketDrawHalfResults
    | typeof weekendMarketTotalGoalsResults
    | typeof weekendMarketStatsResults;
}> = [
  { family: "win", table: weekendMarketWinResults },
  { family: "halfGoal", table: weekendMarketHalfGoalResults },
  { family: "corner", table: weekendMarketCornerResults },
  { family: "combo", table: weekendMarketComboResults },
  { family: "bttsHalves", table: weekendMarketBttsHalvesResults },
  { family: "drawHalf", table: weekendMarketDrawHalfResults },
  { family: "totalGoals", table: weekendMarketTotalGoalsResults },
  { family: "stats", table: weekendMarketStatsResults },
];

function marketKeyFromSelection(selection: string): string {
  return selection.includes(":") ? selection.split(":")[0]! : selection;
}

function teamsForRow(row: RawMarketRow, family: WeekendMarketFamilyId): string[] {
  const mk = marketKeyFromSelection(row.selection);
  if (mk.startsWith("home_") || mk === "home_2h_gt_1h") return [row.homeTeam];
  if (mk.startsWith("away_") || mk === "away_2h_gt_1h") return [row.awayTeam];
  if (family === "combo" && !row.selection.includes(":")) {
    return [row.homeTeam, row.awayTeam];
  }
  return [row.homeTeam, row.awayTeam];
}

function parseLineSuffix(part: string): number | null {
  const m = part.match(/^(\d+(?:_\d+)?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]!.replace("_", "."));
  return Number.isFinite(n) ? n : null;
}

function parseOverUnderSelectionKey(
  key: string,
  marketKey: string
): { selection: string; line: number | null } | null {
  const over = key.match(/^over_(.+)$/);
  if (over) {
    const line = parseLineSuffix(over[1]!);
    return line != null ? { selection: selectionKey(marketKey, "over"), line } : null;
  }
  const under = key.match(/^under_(.+)$/);
  if (under) {
    const line = parseLineSuffix(under[1]!);
    return line != null ? { selection: selectionKey(marketKey, "under"), line } : null;
  }
  return null;
}

function parseTeamCornerSelectionKey(
  key: string
): { selection: string; line: number | null; teamSide: "home" | "away" } | null {
  const m = key.match(/^(home|away)_(over|under)_(\d+(?:_\d+)?)$/);
  if (!m) return null;
  const side = m[1] as "home" | "away";
  const direction = m[2] as "over" | "under";
  const line = parseLineSuffix(m[3]!);
  if (line == null) return null;
  const marketKey = side === "home" ? "home_corners_ou" : "away_corners_ou";
  return {
    selection: selectionKey(marketKey, direction),
    line,
    teamSide: side,
  };
}

const FAMILY_BY_CATEGORY: Record<PortfolioCategoryId, WeekendMarketFamilyId> = {
  hsh_2h: "halfGoal",
  corners: "corner",
  dieh: "drawHalf",
  totals: "totalGoals",
  win_one_half: "win",
  combo: "combo",
  goal_both_halves: "bttsHalves",
  team_corners_ou: "corner",
  result_1x2: "win",
  double_chance: "win",
};

/** Map portfolio leg trace to market-table selection encoding. */
export function portfolioLegToMarketSelection(
  category: PortfolioCategoryId,
  leg: Pick<ScoredLeg, "family" | "selectionKey" | "line" | "comboId">
): PortfolioLegMapping | null {
  const marketFamily = FAMILY_BY_CATEGORY[category];

  if (category === "combo" && leg.comboId) {
    return {
      marketFamily: "combo",
      selection: leg.comboId,
      line: null,
      teamSide: "match",
    };
  }

  if (category === "goal_both_halves") {
    return {
      marketFamily: "bttsHalves",
      selection: selectionKey("goal_both_halves", "yes"),
      line: null,
      teamSide: "match",
    };
  }

  if (category === "hsh_2h") {
    const pred =
      leg.selectionKey === "2h_gt_1h"
        ? "second_half"
        : leg.selectionKey === "1h_gt_2h"
          ? "first_half"
          : leg.selectionKey;
    return {
      marketFamily: "halfGoal",
      selection: selectionKey("more_goals_half", pred),
      line: null,
      teamSide: "match",
    };
  }

  if (category === "team_corners_ou") {
    const parsed = parseTeamCornerSelectionKey(leg.selectionKey);
    if (!parsed) return null;
    return {
      marketFamily: "corner",
      selection: parsed.selection,
      line: parsed.line,
      teamSide: parsed.teamSide,
    };
  }

  const family = leg.family;

  if (family === "CORNERS") {
    const parsed = parseOverUnderSelectionKey(leg.selectionKey, "corners_ou");
    if (!parsed) return null;
    return { marketFamily: "corner", ...parsed, teamSide: "match" };
  }

  if (family === "TOTALS") {
    const parsed = parseOverUnderSelectionKey(leg.selectionKey, "total_goals_ou");
    if (!parsed) return null;
    return { marketFamily: "totalGoals", ...parsed, teamSide: "match" };
  }

  if (family === "DIEH") {
    return {
      marketFamily: "drawHalf",
      selection: selectionKey("draw_one_half", leg.selectionKey === "no" ? "no" : "yes"),
      line: null,
      teamSide: "match",
    };
  }

  if (family === "WIN_ONE_HALF") {
    return {
      marketFamily: "win",
      selection: selectionKey("win_one_half", leg.selectionKey),
      line: null,
      teamSide: leg.selectionKey === "away" ? "away" : "home",
    };
  }

  if (family === "RESULT_1X2") {
    return {
      marketFamily: "win",
      selection: selectionKey("1x2", leg.selectionKey),
      line: null,
      teamSide: leg.selectionKey === "away" ? "away" : leg.selectionKey === "home" ? "home" : "match",
    };
  }

  if (family === "DOUBLE_CHANCE") {
    return {
      marketFamily: "win",
      selection: selectionKey("double_chance", leg.selectionKey),
      line: null,
      teamSide: "match",
    };
  }

  if (family === "BTTS") {
    return {
      marketFamily: "bttsHalves",
      selection: selectionKey("btts", leg.selectionKey),
      line: null,
      teamSide: "match",
    };
  }

  return null;
}

function formatSelectionLabel(selection: string, line: number | null): string {
  if (!selection.includes(":")) return selection.replace(/_/g, " ");
  const [mk, pred] = selection.split(":", 2);
  const label = LOG_MARKET_MAP[mk as LogMarketKey]?.label ?? mk;
  if (line != null) return `${label} ${pred} ${line}`;
  return `${label} ${pred}`;
}

function buildReliabilityRuleText(
  team: string,
  league: string,
  selection: string,
  line: number | null,
  wins: number,
  sample: number
): string {
  const winRate = Math.round((wins / sample) * 100);
  const leg = formatSelectionLabel(selection, line);
  return `${team} — ${leg} wins ${wins}/${sample} weekend pool weeks (${winRate}%) in ${league}.`;
}

type ReliabilityAccumulator = {
  team: string;
  league: string;
  marketFamily: WeekendMarketFamilyId;
  selection: string;
  line: number | null;
  wins: number;
  losses: number;
};

function accKey(parts: {
  team: string;
  league: string;
  marketFamily: string;
  selection: string;
  line: number | null;
}): string {
  return [
    parts.team,
    parts.league,
    parts.marketFamily,
    parts.selection,
    parts.line ?? "null",
  ].join("|");
}

/** Pure aggregation from raw market-table rows (testable). */
export function aggregateMarketReliability(
  rows: MarketTableWinRow[]
): NewAiLearnerMarketReliability[] {
  const acc = new Map<string, ReliabilityAccumulator>();

  for (const row of rows) {
    const league = row.league ?? "Unknown";
    const teams = teamsForRow(row, row.marketFamily);
    for (const team of teams) {
      const key = accKey({
        team,
        league,
        marketFamily: row.marketFamily,
        selection: row.selection,
        line: row.line,
      });
      let bucket = acc.get(key);
      if (!bucket) {
        bucket = {
          team,
          league,
          marketFamily: row.marketFamily,
          selection: row.selection,
          line: row.line,
          wins: 0,
          losses: 0,
        };
        acc.set(key, bucket);
      }
      if (row.result === "win") bucket.wins += 1;
      else if (row.result === "loss") bucket.losses += 1;
    }
  }

  const now = new Date();
  const out: NewAiLearnerMarketReliability[] = [];
  for (const bucket of acc.values()) {
    const sample = bucket.wins + bucket.losses;
    if (sample < MIN_RELIABILITY_SAMPLE) continue;
    const winRate = Math.round((bucket.wins / sample) * 100);
    out.push({
      team: bucket.team,
      league: bucket.league,
      marketFamily: bucket.marketFamily,
      selection: bucket.selection,
      line: bucket.line,
      wins: bucket.wins,
      losses: bucket.losses,
      sample,
      winRate,
      ruleText: buildReliabilityRuleText(
        bucket.team,
        bucket.league,
        bucket.selection,
        bucket.line,
        bucket.wins,
        sample
      ),
      updatedAt: now,
    });
  }

  return out.sort(
    (a, b) =>
      (b.winRate ?? 0) - (a.winRate ?? 0) || (b.sample ?? 0) - (a.sample ?? 0)
  );
}

export function reliabilityEntryFromDb(
  row: typeof aiLearnerMarketReliability.$inferSelect
): MarketReliabilityEntry {
  return {
    team: row.team,
    league: row.league,
    marketFamily: row.marketFamily,
    selection: row.selection,
    line: row.line ?? undefined,
    winRate: row.winRate ?? 0,
    sample: row.sample,
    ruleText: row.ruleText,
  };
}

export function pickTopAndWeakTeamMarkets(
  entries: MarketReliabilityEntry[]
): {
  topTeamMarkets: MarketReliabilityEntry[];
  weakTeamMarkets: MarketReliabilityEntry[];
} {
  const topTeamMarkets = entries
    .filter((e) => e.sample >= MIN_RELIABILITY_SAMPLE && e.winRate >= 65)
    .slice(0, 20);
  const weakTeamMarkets = entries
    .filter((e) => e.sample >= MIN_RELIABILITY_SAMPLE && e.winRate <= 35)
    .slice(0, 20);
  return { topTeamMarkets, weakTeamMarkets };
}

export function findTeamMarketReliability(
  team: string,
  league: string,
  marketFamily: string,
  selection: string,
  line: number | null | undefined,
  entries: MarketReliabilityEntry[]
): MarketReliabilityEntry | null {
  let best: MarketReliabilityEntry | null = null;
  for (const e of entries) {
    if (e.team !== team) continue;
    if (e.league !== league && e.league !== "Unknown") continue;
    if (e.marketFamily !== marketFamily) continue;
    if (e.selection !== selection) continue;
    if ((e.line ?? null) !== (line ?? null)) continue;
    if (!best || e.winRate > best.winRate || (e.winRate === best.winRate && e.sample > best.sample)) {
      best = e;
    }
  }
  return best;
}

/** Modest portfolio score adjustment from weekend pool history. */
export function computeReliabilityScoreBoost(
  winRate: number,
  sample: number
): number {
  if (sample < MIN_RELIABILITY_SAMPLE) return 0;
  if (winRate >= 65) return Math.min(5, Math.round((winRate - 50) / 3));
  if (winRate <= 35) return -Math.min(3, Math.round((50 - winRate) / 5));
  return 0;
}

export function lookupPortfolioReliabilityBoost(input: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  mapping: PortfolioLegMapping;
  entries: MarketReliabilityEntry[];
}): { boost: number; entry: MarketReliabilityEntry | null; note: string | null } {
  const teams =
    input.mapping.teamSide === "home"
      ? [input.homeTeam]
      : input.mapping.teamSide === "away"
        ? [input.awayTeam]
        : [input.homeTeam, input.awayTeam];

  let bestEntry: MarketReliabilityEntry | null = null;
  let bestBoost = 0;

  for (const team of teams) {
    const entry = findTeamMarketReliability(
      team,
      input.league,
      input.mapping.marketFamily,
      input.mapping.selection,
      input.mapping.line,
      input.entries
    );
    if (!entry) continue;
    const boost = computeReliabilityScoreBoost(entry.winRate, entry.sample);
    if (
      !bestEntry ||
      Math.abs(boost) > Math.abs(bestBoost) ||
      (boost === bestBoost && entry.sample > bestEntry.sample)
    ) {
      bestEntry = entry;
      bestBoost = boost;
    }
  }

  if (!bestEntry || bestBoost === 0) {
    return { boost: 0, entry: null, note: null };
  }

  const note =
    bestBoost > 0
      ? `Weekend pool history: ${bestEntry.ruleText}`
      : `Weekend pool caution: ${bestEntry.ruleText}`;

  return { boost: bestBoost, entry: bestEntry, note };
}

export function outcomeMatchKey(
  batchId: string,
  matchId: string,
  providerFixtureId?: number | null,
  matchDate?: string | null
): string {
  if (batchId && matchId) return `${batchId}|${matchId}`;
  if (providerFixtureId != null && matchDate) return `fx:${providerFixtureId}|${matchDate}`;
  return `${batchId}|${matchId}`;
}

export function marketRowToRecoveryAlternative(
  row: MarketTableWinRow
): { market: string; prediction: string; line?: number } | null {
  if (row.result !== "win") return null;
  if (!row.selection.includes(":")) {
    return { market: "combo", prediction: row.selection, line: undefined };
  }
  const [marketKey, prediction] = row.selection.split(":", 2);
  if (!marketKey || !prediction) return null;
  return {
    market: marketKey,
    prediction,
    line: row.line ?? undefined,
  };
}

export function winningAlternativesFromMarketRows(
  lost: {
    marketKey: string;
    prediction: string;
    line?: number | null;
  },
  winRows: MarketTableWinRow[]
): Array<{ market: string; prediction: string; line?: number }> {
  const out: Array<{ market: string; prediction: string; line?: number }> = [];
  const seen = new Set<string>();

  for (const row of winRows) {
    const alt = marketRowToRecoveryAlternative(row);
    if (!alt) continue;

    const sameLost =
      alt.market === lost.marketKey &&
      alt.prediction === lost.prediction &&
      (alt.line ?? null) === (lost.line ?? null);
    if (sameLost) continue;

    const sig = `${alt.market}:${alt.prediction}:${alt.line ?? ""}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(alt);
  }

  return out;
}

export function mergeWinningAlternatives(
  a: Array<{ market: string; prediction: string; line?: number }>,
  b: Array<{ market: string; prediction: string; line?: number }>
): Array<{ market: string; prediction: string; line?: number }> {
  const seen = new Set<string>();
  const out: Array<{ market: string; prediction: string; line?: number }> = [];
  for (const alt of [...a, ...b]) {
    const sig = `${alt.market}:${alt.prediction}:${alt.line ?? ""}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(alt);
  }
  return out;
}

async function loadAllMarketTableRows(): Promise<MarketTableWinRow[]> {
  const db = await getDb();
  const out: MarketTableWinRow[] = [];

  for (const { family, table } of FAMILY_TABLES) {
    const rows = await db.select().from(table);
    for (const row of rows) {
      out.push({
        weekendBatchId: row.weekendBatchId,
        matchId: row.matchId,
        providerFixtureId: row.providerFixtureId,
        league: row.league,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        matchDate: row.matchDate,
        selection: row.selection,
        line: row.line,
        actualValue: row.actualValue,
        result: row.result as "win" | "loss",
        wasWeekendPick: row.wasWeekendPick,
        marketFamily: family,
      });
    }
  }

  return out;
}

export async function loadMarketTableWinsGroupedByMatch(): Promise<
  Map<string, MarketTableWinRow[]>
> {
  const rows = await loadAllMarketTableRows();
  const grouped = new Map<string, MarketTableWinRow[]>();

  for (const row of rows) {
    if (row.result !== "win") continue;
    const key = outcomeMatchKey(
      row.weekendBatchId,
      row.matchId,
      row.providerFixtureId,
      row.matchDate
    );
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  return grouped;
}

export async function recomputeAndPersistMarketReliability(): Promise<number> {
  const rows = await loadAllMarketTableRows();
  const aggregated = aggregateMarketReliability(rows);

  const db = await getDb();
  await db.delete(aiLearnerMarketReliability);

  if (aggregated.length === 0) return 0;

  await db.insert(aiLearnerMarketReliability).values(aggregated);
  return aggregated.length;
}

export async function loadMarketReliability(): Promise<MarketReliabilityEntry[]> {
  const db = await getDb();
  const rows = await db.select().from(aiLearnerMarketReliability);
  return rows.map(reliabilityEntryFromDb);
}

export async function countMarketReliability(): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ id: aiLearnerMarketReliability.id }).from(aiLearnerMarketReliability);
  return rows.length;
}
