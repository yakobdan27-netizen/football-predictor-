import type { CorrectScoreCalibration, CorrectScoreSnapshot } from "./types";

export const DISPLAY_GRID_MAX = 6;

export const CORRECT_SCORE_HONESTY_NOTE =
  "Correct score has many possible outcomes, so every single score has a low probability — this is expected. Use these estimates to judge how predictable a match is and to sanity-check other markets, not as a standalone safe bet.";

export const CONCENTRATION_HIGH_THRESHOLD = 35;
export const CONCENTRATION_LOW_THRESHOLD = 25;
export const LOW_CONCENTRATION_BAYESIAN_SCALE = 1.15;

export interface CappedGrid {
  capped: number[][];
  otherProb: number;
  totalProb: number;
}

export interface ScorelineEntry {
  home: number;
  away: number;
  probPct: number;
  fairOdds: number;
}

export interface CorrectScoreAnalysis {
  mostLikely: ScorelineEntry;
  top6: Array<ScorelineEntry & { rank: number }>;
  otherProbPct: number;
  resultProbs: { home: number; draw: number; away: number };
  concentrationIndex: number;
  winningMargin: { label: string; probPct: number } | null;
  cleanSheets: { home: number; away: number };
  scoresToAvoid: Array<{ home: number; away: number; probPct: number; reason: string }>;
  displayGrid: number[][];
  topCell: { home: number; away: number };
}

export function fairOdds(probPct: number): number {
  if (probPct <= 0) return 0;
  return Math.round((100 / probPct) * 100) / 100;
}

export function capGridAtSix(grid: number[][]): CappedGrid {
  if (!grid.length) {
    return { capped: [], otherProb: 0, totalProb: 0 };
  }

  const size = DISPLAY_GRID_MAX + 1;
  const capped: number[][] = Array.from({ length: size }, () => Array(size).fill(0));
  let otherProb = 0;
  let totalProb = 0;

  for (let h = 0; h < grid.length; h++) {
    for (let a = 0; a < (grid[h]?.length ?? 0); a++) {
      const p = grid[h]![a] ?? 0;
      totalProb += p;
      if (h <= DISPLAY_GRID_MAX && a <= DISPLAY_GRID_MAX) {
        capped[h]![a]! += p;
      } else {
        otherProb += p;
      }
    }
  }

  return { capped, otherProb, totalProb };
}

export function scorelineProb(grid: number[][], home: number, away: number): number {
  const { capped, otherProb } = capGridAtSix(grid);
  if (home > DISPLAY_GRID_MAX || away > DISPLAY_GRID_MAX) {
    return otherProb;
  }
  return capped[home]?.[away] ?? 0;
}

export function scorelineProbPct(grid: number[][], home: number, away: number): number {
  return Math.round(scorelineProb(grid, home, away) * 1000) / 10;
}

function enumerateScorelines(capped: number[][]): ScorelineEntry[] {
  const entries: ScorelineEntry[] = [];
  for (let h = 0; h < capped.length; h++) {
    for (let a = 0; a < (capped[h]?.length ?? 0); a++) {
      const prob = capped[h]![a] ?? 0;
      if (prob <= 0) continue;
      const probPct = Math.round(prob * 1000) / 10;
      entries.push({ home: h, away: a, probPct, fairOdds: fairOdds(probPct) });
    }
  }
  entries.sort((a, b) => b.probPct - a.probPct);
  return entries;
}

function computeResultProbs(capped: number[][]): { home: number; draw: number; away: number } {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h < capped.length; h++) {
    for (let a = 0; a < (capped[h]?.length ?? 0); a++) {
      const p = capped[h]![a] ?? 0;
      if (h > a) home += p;
      else if (h === a) draw += p;
      else away += p;
    }
  }
  return {
    home: Math.round(home * 1000) / 10,
    draw: Math.round(draw * 1000) / 10,
    away: Math.round(away * 1000) / 10,
  };
}

function computeWinningMargin(capped: number[][]): { label: string; probPct: number } | null {
  const margins = new Map<string, number>();
  for (let h = 0; h < capped.length; h++) {
    for (let a = 0; a < (capped[h]?.length ?? 0); a++) {
      const p = capped[h]![a] ?? 0;
      if (p <= 0) continue;
      const diff = h - a;
      let label: string;
      if (diff > 0) label = `home by ${diff} goal${diff > 1 ? "s" : ""}`;
      else if (diff < 0) label = `away by ${-diff} goal${-diff > 1 ? "s" : ""}`;
      else label = "draw";
      margins.set(label, (margins.get(label) ?? 0) + p);
    }
  }
  if (margins.size === 0) return null;
  const best = [...margins.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return { label: best[0], probPct: Math.round(best[1] * 1000) / 10 };
}

function computeCleanSheets(capped: number[][]): { home: number; away: number } {
  let homeCs = 0;
  let awayCs = 0;
  for (let h = 0; h < capped.length; h++) {
    for (let a = 0; a < (capped[h]?.length ?? 0); a++) {
      const p = capped[h]![a] ?? 0;
      if (a === 0) homeCs += p;
      if (h === 0) awayCs += p;
    }
  }
  return {
    home: Math.round(homeCs * 1000) / 10,
    away: Math.round(awayCs * 1000) / 10,
  };
}

function buildScoresToAvoid(
  entries: ScorelineEntry[],
  resultProbs: { home: number; draw: number; away: number },
  cleanSheets: { home: number; away: number }
): Array<{ home: number; away: number; probPct: number; reason: string }> {
  const plausible = entries.filter(
    (e) => e.home <= 4 && e.away <= 4 && !(e.home === 0 && e.away === 0 && e.probPct < 1)
  );
  const sorted = [...plausible].sort((a, b) => a.probPct - b.probPct);
  const avoid: Array<{ home: number; away: number; probPct: number; reason: string }> = [];

  for (const entry of sorted) {
    if (avoid.length >= 3) break;
    let reason = "Low model probability";
    if (entry.home === 0 && entry.away === 0 && resultProbs.draw < 25) {
      reason = "0–0 unlikely when draw probability is low";
    } else if (entry.home === 0 && entry.away === 0 && cleanSheets.home < 20) {
      reason = "0–0 overpriced when home clean sheet is unlikely";
    } else if (entry.home === 0 && entry.away === 0) {
      reason = "0–0 often overpriced by bookmakers";
    } else if (entry.probPct < 3) {
      reason = "Very low probability tail score";
    }
    avoid.push({ home: entry.home, away: entry.away, probPct: entry.probPct, reason });
  }

  return avoid.slice(0, 3);
}

export function analyzeCorrectScore(grid: number[][]): CorrectScoreAnalysis | null {
  if (!grid.length) return null;

  const { capped, otherProb } = capGridAtSix(grid);
  const allEntries = enumerateScorelines(capped);
  if (allEntries.length === 0) return null;

  const top6 = allEntries.slice(0, 6).map((e, i) => ({ ...e, rank: i + 1 }));
  const top6Sum = top6.reduce((s, e) => s + e.probPct, 0);
  const otherProbPct = Math.round((otherProb * 100 + Math.max(0, 100 - top6Sum - otherProb * 100)) * 10) / 10;
  const concentrationIndex = Math.round(top6.slice(0, 3).reduce((s, e) => s + e.probPct, 0) * 10) / 10;
  const resultProbs = computeResultProbs(capped);
  const winningMargin = computeWinningMargin(capped);
  const cleanSheets = computeCleanSheets(capped);
  const scoresToAvoid = buildScoresToAvoid(allEntries, resultProbs, cleanSheets);
  const mostLikely = allEntries[0]!;

  return {
    mostLikely,
    top6,
    otherProbPct: Math.max(0, Math.round(otherProbPct * 10) / 10),
    resultProbs,
    concentrationIndex,
    winningMargin,
    cleanSheets,
    scoresToAvoid,
    displayGrid: capped,
    topCell: { home: mostLikely.home, away: mostLikely.away },
  };
}

export function formatScoreline(home: number, away: number): string {
  return `${home}–${away}`;
}

export function analysisToSnapshot(analysis: CorrectScoreAnalysis): CorrectScoreSnapshot {
  return {
    top6: analysis.top6.map((e) => ({ home: e.home, away: e.away, probPct: e.probPct })),
    concentrationIndex: analysis.concentrationIndex,
    mostLikely: {
      home: analysis.mostLikely.home,
      away: analysis.mostLikely.away,
      probPct: analysis.mostLikely.probPct,
    },
  };
}

export type CorrectScoreRank = CorrectScoreCalibration["rank"];

export function rankActualScore(
  snapshot: CorrectScoreSnapshot,
  homeGoals: number,
  awayGoals: number
): CorrectScoreRank {
  const actualH = Math.min(homeGoals, DISPLAY_GRID_MAX);
  const actualA = Math.min(awayGoals, DISPLAY_GRID_MAX);
  const inTop6 = snapshot.top6.some((s) => s.home === actualH && s.away === actualA);
  if (!inTop6) return "outside";
  const idx = snapshot.top6.findIndex((s) => s.home === actualH && s.away === actualA);
  if (idx === 0) return "top1";
  if (idx < 3) return "top3";
  return "top6";
}

export function compareWeakestByConcentration(
  aFinal: number,
  bFinal: number,
  aConc: number,
  bConc: number
): number {
  if (aFinal !== bFinal) return aFinal - bFinal;
  return aConc - bConc;
}

export function isLowConcentration(concentrationIndex: number): boolean {
  return concentrationIndex < CONCENTRATION_LOW_THRESHOLD;
}

export function isHighConcentration(concentrationIndex: number): boolean {
  return concentrationIndex > CONCENTRATION_HIGH_THRESHOLD;
}
