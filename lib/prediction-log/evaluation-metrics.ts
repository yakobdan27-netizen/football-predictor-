/**
 * Long-term evaluation metrics: CLV, yield, drawdown, streaks, Monte Carlo risk-of-ruin.
 */

import { MIN_BETS_FOR_MEANINGFUL_METRICS } from "./recommendation-config";
import { impliedProbability } from "./odds-bands";
import {
  matchConfidencePct,
  matchLoggedOdds,
  matchPnL,
  primaryLegResult,
} from "./strategy-rules";
import type { LogMatch, PredictionBatch } from "./types";

export interface SettledBetRow {
  batchId: string;
  batchDate: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  stake: number;
  odds: number;
  closingOdds: number | null;
  result: "correct" | "wrong";
  pnl: number;
  clvPct: number | null;
  modelProb: number | null;
  ev: number | null;
}

export interface EvaluationMetrics {
  n: number;
  metricsMeaningful: boolean;
  totalStaked: number;
  totalPnL: number;
  yieldPct: number | null;
  roiPct: number | null;
  winRate: number | null;
  wins: number;
  losses: number;
  avgOdds: number | null;
  meanClvPct: number | null;
  clvSample: number;
  meanEv: number | null;
  maxDrawdown: number;
  longestLosingStreak: number;
  rollingYield50: number | null;
  rollingYield100: number | null;
  rollingYield250: number | null;
  cumulativePnL: number[];
  clvSeries: Array<{ date: string; clvPct: number }>;
}

export interface MonteCarloResult {
  simulations: number;
  betsPerSim: number;
  winRate: number;
  stakePct: number;
  pRuin50: number;
  medianFinalBankrollPct: number;
  p5FinalBankrollPct: number;
  p95FinalBankrollPct: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Closing-line value in percentage points of implied probability (beat close = positive). */
export function clvPct(takenOdds: number, closingOdds: number): number | null {
  if (!(takenOdds > 1) || !(closingOdds > 1)) return null;
  const edge = impliedProbability(closingOdds) - impliedProbability(takenOdds);
  return round1(edge * 100);
}

export function collectSettledBets(batches: PredictionBatch[]): SettledBetRow[] {
  const rows: SettledBetRow[] = [];
  const sorted = [...batches].sort((a, b) => a.date.localeCompare(b.date));

  for (const batch of sorted) {
    for (const m of batch.matches) {
      const result = primaryLegResult(m);
      if (result !== "correct" && result !== "wrong") continue;
      const stake = m.stake;
      const odds = matchLoggedOdds(m);
      if (stake == null || !Number.isFinite(stake) || stake <= 0 || odds == null) continue;
      const pnl = matchPnL(m);
      if (pnl == null) continue;

      const closing =
        m.closingOdds != null && Number.isFinite(m.closingOdds) && m.closingOdds > 1
          ? m.closingOdds
          : null;
      const modelProb = matchConfidencePct(m);
      const p = modelProb != null ? Math.min(0.99, Math.max(0.01, modelProb / 100)) : null;
      const ev =
        p != null ? round2(stake * (p * (odds - 1) - (1 - p))) : null;

      rows.push({
        batchId: batch.id,
        batchDate: batch.date,
        matchId: m.id,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        stake,
        odds,
        closingOdds: closing,
        result,
        pnl,
        clvPct: closing != null ? clvPct(odds, closing) : null,
        modelProb,
        ev,
      });
    }
  }

  return rows;
}

function rollingYield(rows: SettledBetRow[], window: number): number | null {
  if (rows.length === 0) return null;
  const slice = rows.slice(-window);
  let staked = 0;
  let pnl = 0;
  for (const r of slice) {
    staked += r.stake;
    pnl += r.pnl;
  }
  if (staked <= 0) return null;
  return round1((pnl / staked) * 100);
}

function maxDrawdownFromPnL(pnls: number[]): number {
  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  for (const p of pnls) {
    equity += p;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  return round2(maxDd);
}

function longestLosingStreak(rows: SettledBetRow[]): number {
  let best = 0;
  let cur = 0;
  for (const r of rows) {
    if (r.result === "wrong") {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

export function computeEvaluationMetrics(batches: PredictionBatch[]): EvaluationMetrics {
  const rows = collectSettledBets(batches);
  const n = rows.length;
  let totalStaked = 0;
  let totalPnL = 0;
  let wins = 0;
  let losses = 0;
  let oddsSum = 0;
  let clvSum = 0;
  let clvSample = 0;
  let evSum = 0;
  let evSample = 0;
  const cumulativePnL: number[] = [];
  const clvSeries: Array<{ date: string; clvPct: number }> = [];
  let running = 0;

  for (const r of rows) {
    totalStaked += r.stake;
    totalPnL += r.pnl;
    running += r.pnl;
    cumulativePnL.push(round2(running));
    oddsSum += r.odds;
    if (r.result === "correct") wins++;
    else losses++;
    if (r.clvPct != null) {
      clvSum += r.clvPct;
      clvSample++;
      clvSeries.push({ date: r.batchDate, clvPct: r.clvPct });
    }
    if (r.ev != null) {
      evSum += r.ev;
      evSample++;
    }
  }

  const yieldPct =
    totalStaked > 0 ? round1((totalPnL / totalStaked) * 100) : null;

  return {
    n,
    metricsMeaningful: n >= MIN_BETS_FOR_MEANINGFUL_METRICS,
    totalStaked: round2(totalStaked),
    totalPnL: round2(totalPnL),
    yieldPct,
    roiPct: yieldPct,
    winRate: wins + losses > 0 ? round1((wins / (wins + losses)) * 100) : null,
    wins,
    losses,
    avgOdds: n > 0 ? round2(oddsSum / n) : null,
    meanClvPct: clvSample > 0 ? round1(clvSum / clvSample) : null,
    clvSample,
    meanEv: evSample > 0 ? round2(evSum / evSample) : null,
    maxDrawdown: maxDrawdownFromPnL(rows.map((r) => r.pnl)),
    longestLosingStreak: longestLosingStreak(rows),
    rollingYield50: rollingYield(rows, 50),
    rollingYield100: rollingYield(rows, 100),
    rollingYield250: rollingYield(rows, 250),
    cumulativePnL,
    clvSeries,
  };
}

/** Mulberry32 PRNG for deterministic Monte Carlo. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reality Check: simulate risk of losing ≥50% of bankroll over `betsPerSim` flat bets.
 */
export function runRealityCheckMonteCarlo(opts: {
  winRatePct: number;
  avgOdds: number;
  stakePct: number;
  simulations?: number;
  betsPerSim?: number;
  seed?: number;
}): MonteCarloResult {
  const simulations = opts.simulations ?? 2000;
  const betsPerSim = opts.betsPerSim ?? 500;
  const winRate = Math.min(0.99, Math.max(0.01, opts.winRatePct / 100));
  const odds = Math.max(1.01, opts.avgOdds);
  const stakePct = Math.min(0.05, Math.max(0.001, opts.stakePct / 100));
  const rand = mulberry32(opts.seed ?? 42);

  let ruinCount = 0;
  const finals: number[] = [];

  for (let s = 0; s < simulations; s++) {
    let bank = 1;
    let hitRuin = false;
    for (let i = 0; i < betsPerSim; i++) {
      const stake = bank * stakePct;
      if (rand() < winRate) {
        bank += stake * (odds - 1);
      } else {
        bank -= stake;
      }
      if (bank <= 0.5) hitRuin = true;
      if (bank <= 0.01) {
        bank = 0.01;
        hitRuin = true;
        break;
      }
    }
    if (hitRuin) ruinCount++;
    finals.push(bank * 100);
  }

  finals.sort((a, b) => a - b);
  const p5 = finals[Math.floor(simulations * 0.05)] ?? 0;
  const p50 = finals[Math.floor(simulations * 0.5)] ?? 0;
  const p95 = finals[Math.floor(simulations * 0.95)] ?? 0;

  return {
    simulations,
    betsPerSim,
    winRate: round1(winRate * 100),
    stakePct: round1(opts.stakePct),
    pRuin50: round1((ruinCount / simulations) * 100),
    medianFinalBankrollPct: round1(p50),
    p5FinalBankrollPct: round1(p5),
    p95FinalBankrollPct: round1(p95),
  };
}

export function evaluationRowsToCsv(rows: SettledBetRow[]): string {
  const header = [
    "date",
    "batchId",
    "matchId",
    "home",
    "away",
    "stake",
    "odds",
    "closingOdds",
    "result",
    "pnl",
    "clvPct",
    "modelProb",
    "ev",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.batchDate,
        r.batchId,
        r.matchId,
        csvEscape(r.homeTeam),
        csvEscape(r.awayTeam),
        r.stake,
        r.odds,
        r.closingOdds ?? "",
        r.result,
        r.pnl,
        r.clvPct ?? "",
        r.modelProb ?? "",
        r.ev ?? "",
      ].join(",")
    );
  }
  return lines.join("\n");
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Match helper for UI: set closing odds on a LogMatch. */
export function withClosingOdds(match: LogMatch, value: string): LogMatch {
  const t = value.trim();
  if (t === "") {
    const next = { ...match };
    delete next.closingOdds;
    return next;
  }
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n <= 1) return match;
  return { ...match, closingOdds: Math.round(n * 100) / 100 };
}
