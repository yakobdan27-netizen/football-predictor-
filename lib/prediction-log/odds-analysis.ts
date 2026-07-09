import { ODDS_BAND_IDS, isValidOdds, oddsToBand } from "./odds-bands";
import type { OddsAnalysisHistory, OddsBandId, OddsBandStats, ScoredRow } from "./types";

const LOW_SAMPLE_THRESHOLD = 10;
const RECENT_PICKS = 30;

function emptyBand(band: OddsBandId): OddsBandStats {
  return {
    band,
    total: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    winRate: null,
    avgWinOdds: null,
    avgLossOdds: null,
    valueScore: null,
    lowSample: true,
  };
}

function emptyBands(): Record<OddsBandId, OddsBandStats> {
  return Object.fromEntries(ODDS_BAND_IDS.map((b) => [b, emptyBand(b)])) as Record<
    OddsBandId,
    OddsBandStats
  >;
}

function emptyOddsArrays(): Record<OddsBandId, number[]> {
  return {
    "1.00-1.50": [],
    "1.51-2.00": [],
    "2.01-2.50": [],
    "2.51-3.00": [],
  };
}

function aggregateBands(rows: ScoredRow[]): Record<OddsBandId, OddsBandStats> {
  const bands = emptyBands();
  const winOdds = emptyOddsArrays();
  const lossOdds = emptyOddsArrays();

  for (const row of rows) {
    if (row.odds == null || !isValidOdds(row.odds)) continue;
    const band = oddsToBand(row.odds);
    const s = bands[band];
    s.total++;
    if (row.result === "correct") {
      s.wins++;
      winOdds[band].push(row.odds);
    } else if (row.result === "wrong") {
      s.losses++;
      lossOdds[band].push(row.odds);
    } else if (row.result === "push") {
      s.pushes++;
    }
  }

  for (const band of ODDS_BAND_IDS) {
    const s = bands[band];
    const denom = s.wins + s.losses;
    s.lowSample = denom < LOW_SAMPLE_THRESHOLD;
    s.winRate = denom > 0 ? Math.round((s.wins / denom) * 100) : null;
    if (winOdds[band].length > 0) {
      s.avgWinOdds =
        Math.round((winOdds[band].reduce((a, b) => a + b, 0) / winOdds[band].length) * 100) /
        100;
    }
    if (lossOdds[band].length > 0) {
      s.avgLossOdds =
        Math.round((lossOdds[band].reduce((a, b) => a + b, 0) / lossOdds[band].length) * 100) /
        100;
    }
    if (s.winRate != null && s.avgWinOdds != null && !s.lowSample) {
      s.valueScore = Math.round((s.winRate / 100) * s.avgWinOdds * 100) / 100;
    }
  }

  return bands;
}

function pickBestBand(
  bands: Record<OddsBandId, OddsBandStats>,
  mode: "winRate" | "lossRate" | "value"
): OddsBandId | null {
  let best: OddsBandId | null = null;
  let bestScore = mode === "lossRate" ? Infinity : -Infinity;

  for (const band of ODDS_BAND_IDS) {
    const s = bands[band];
    const denom = s.wins + s.losses;
    if (denom < 3 || s.lowSample) continue;

    let score: number;
    if (mode === "winRate") score = s.winRate ?? -1;
    else if (mode === "lossRate") score = s.winRate ?? 101;
    else score = s.valueScore ?? -1;

    if (mode === "lossRate") {
      if (score < bestScore) {
        bestScore = score;
        best = band;
      }
    } else if (score > bestScore) {
      bestScore = score;
      best = band;
    }
  }
  return best;
}

export function emptyOddsAnalysis(): OddsAnalysisHistory {
  const bands = emptyBands();
  return {
    bands,
    recentBands: emptyBands(),
    mostWonBand: null,
    mostLostBand: null,
    bestValueBand: null,
  };
}

export function computeOddsAnalysis(rows: ScoredRow[]): OddsAnalysisHistory {
  const withOdds = rows.filter((r) => r.odds != null && isValidOdds(r.odds));
  if (withOdds.length === 0) return emptyOddsAnalysis();

  const bands = aggregateBands(withOdds);
  const recentRows = withOdds
    .filter((r) => r.result === "correct" || r.result === "wrong" || r.result === "push")
    .slice(0, RECENT_PICKS);
  const recentBands = aggregateBands(recentRows);

  return {
    bands,
    recentBands,
    mostWonBand: pickBestBand(bands, "winRate"),
    mostLostBand: pickBestBand(bands, "lossRate"),
    bestValueBand: pickBestBand(bands, "value"),
  };
}
