import { flattenScoredRows } from "./analysis";
import { LOG_MARKETS } from "./markets-config";
import { oddsToBand } from "./odds-bands";
import type {
  AnalysisHistory,
  LearnerStatsStore,
  LogMarketKey,
  PredictionBatch,
  ScoredRow,
  TeamCharacteristicsStore,
} from "./types";

export interface MarketPattern {
  market: LogMarketKey;
  label: string;
  wins: number;
  losses: number;
  winRate: number | null;
}

export interface MatchupPattern {
  homeTeam: string;
  awayTeam: string;
  league: string;
  wins: number;
  losses: number;
  winRate: number | null;
  sample: number;
}

export interface LuckyNumberPattern {
  number: number;
  wins: number;
  losses: number;
  winRate: number | null;
  sample: number;
}

export interface LearnerPatterns {
  bestOddsBand: string | null;
  worstOddsBand: string | null;
  topMarkets: MarketPattern[];
  weakestMarkets: MarketPattern[];
  matchupTendencies: MatchupPattern[];
  batchPatterns: LearnerStatsStore["batchPatterns"];
  cautiousClubs: LearnerStatsStore["cautiousClubs"];
  luckyNumberPerformance: LuckyNumberPattern[];
}

function marketPatternsFromRows(rows: ScoredRow[]): MarketPattern[] {
  const labelMap = Object.fromEntries(LOG_MARKETS.map((m) => [m.key, m.label]));
  const map = new Map<LogMarketKey, { wins: number; losses: number }>();

  for (const row of rows) {
    if (row.result !== "correct" && row.result !== "wrong") continue;
    const entry = map.get(row.market) ?? { wins: 0, losses: 0 };
    if (row.result === "correct") entry.wins++;
    else entry.losses++;
    map.set(row.market, entry);
  }

  return [...map.entries()]
    .map(([market, { wins, losses }]) => {
      const sample = wins + losses;
      return {
        market,
        label: labelMap[market] ?? market,
        wins,
        losses,
        winRate: sample > 0 ? Math.round((wins / sample) * 100) : null,
      };
    })
    .filter((m) => m.wins + m.losses >= 3)
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));
}

function matchupPatternsFromRows(rows: ScoredRow[]): MatchupPattern[] {
  const map = new Map<string, MatchupPattern>();

  for (const row of rows) {
    if (row.result !== "correct" && row.result !== "wrong") continue;
    const key = `${row.league}|${row.homeTeam}|${row.awayTeam}`;
    const entry = map.get(key) ?? {
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      league: row.league,
      wins: 0,
      losses: 0,
      winRate: null,
      sample: 0,
    };
    if (row.result === "correct") entry.wins++;
    else entry.losses++;
    entry.sample = entry.wins + entry.losses;
    entry.winRate =
      entry.sample > 0 ? Math.round((entry.wins / entry.sample) * 100) : null;
    map.set(key, entry);
  }

  return [...map.values()]
    .filter((m) => m.sample >= 2)
    .sort((a, b) => b.sample - a.sample)
    .slice(0, 10);
}

function luckyPatternsFromRows(
  rows: ScoredRow[],
  luckyNumbers: number[]
): LuckyNumberPattern[] {
  if (!luckyNumbers.length) return [];

  return luckyNumbers.map((num) => {
    let wins = 0;
    let losses = 0;
    for (const row of rows) {
      if (row.result !== "correct" && row.result !== "wrong") continue;
      if (row.odds == null) continue;
      const cents = Math.round((row.odds % 1) * 100);
      const tenths = Math.round((row.odds % 1) * 10);
      if (cents !== num && tenths !== num) continue;
      if (row.result === "correct") wins++;
      else losses++;
    }
    const sample = wins + losses;
    return {
      number: num,
      wins,
      losses,
      sample,
      winRate: sample > 0 ? Math.round((wins / sample) * 100) : null,
    };
  });
}

export function computeLearnerPatterns(
  batches: PredictionBatch[],
  analysis: AnalysisHistory | null,
  learnerStats: LearnerStatsStore,
  teamCharacteristics: TeamCharacteristicsStore,
  luckyNumbers: number[] = []
): LearnerPatterns {
  const rows = flattenScoredRows(batches);
  const markets = marketPatternsFromRows(rows);

  const bestBand =
    learnerStats.topReliableRanges[0] ??
    analysis?.oddsAnalysis.mostWonBand ??
    null;
  const worstBand =
    learnerStats.weakestRanges[0] ??
    analysis?.oddsAnalysis.mostLostBand ??
    null;

  return {
    bestOddsBand: bestBand,
    worstOddsBand: worstBand,
    topMarkets: markets.slice(0, 5),
    weakestMarkets: [...markets].reverse().slice(0, 5),
    matchupTendencies: matchupPatternsFromRows(rows),
    batchPatterns: learnerStats.batchPatterns,
    cautiousClubs: learnerStats.cautiousClubs,
    luckyNumberPerformance: luckyPatternsFromRows(rows, luckyNumbers),
  };
}

export function overallWinRate(learnerStats: LearnerStatsStore): number | null {
  let wins = 0;
  let losses = 0;
  for (const band of learnerStats.oddsRanges) {
    wins += band.wins;
    losses += band.losses;
  }
  const total = wins + losses;
  return total > 0 ? Math.round((wins / total) * 100) : null;
}

export function totalSavedBatches(batches: PredictionBatch[]): number {
  return batches.length;
}

export function totalMatchesInBatches(batches: PredictionBatch[]): number {
  return batches.reduce((sum, b) => sum + b.matches.length, 0);
}
