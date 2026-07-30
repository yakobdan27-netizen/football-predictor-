import type { TwoHHeavyResult } from "@/lib/prediction-log/two-h-heavy";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { compareTwoHHeavy } from "@/lib/prediction-log/two-h-heavy";
import {
  COMBINED_HIGH,
  COMBINED_MEDIUM,
  FILL_FROM_DB,
  MAX_LEGS,
  RISK_THRESHOLD,
} from "./config";

export type RiskExposure = "HIGH" | "Medium" | "Low" | "Very Low";

export interface LadderMatch {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  /** Kickoff datetime string, or FILL_FROM_DB when missing. */
  kickoff: string;
  /** Model P(2H>1H), or null when missing/non-finite. */
  p2h_gt_1h: number | null;
  /** Display string for probability. */
  p2h_display: string;
  confidence: number | null;
  confidence_display: string;
  survival: number | null;
  /** Drop-order letter: A = weakest (dropped first). */
  letter: string;
  apiFixtureId?: number;
}

export interface LadderRound {
  round: number;
  label: string;
  bets: number;
  /** Match ids still in this round (strongest-first). */
  legIds: string[];
  /** Letters of legs still in the round (strongest-first). */
  legLetters: string[];
  /** Summary of legs for table column. */
  legsSummary: string;
  /** Risky letters (p < RISK_THRESHOLD) still included. */
  risky_matches: string[];
  risky_display: string;
  combined_prob: number | null;
  combined_display: string;
  risk_exposure: RiskExposure;
  suggestedStake?: number;
}

export interface LadderResult {
  matches: LadderMatch[];
  rounds: LadderRound[];
  /** Drop order letters A.. (weakest first). */
  dropOrder: string[];
  shortfallNotice: string | null;
  n: number;
}

function letterAt(index: number): string {
  return String.fromCharCode(65 + index);
}

function formatProb(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return FILL_FROM_DB;
  return `${(p * 100).toFixed(1)}%`;
}

function isFiniteProb(p: number | null | undefined): p is number {
  return p != null && Number.isFinite(p);
}

export function riskExposureFor(params: {
  combined_prob: number | null;
  bets: number;
  riskyCount: number;
}): RiskExposure {
  const { combined_prob, bets, riskyCount } = params;
  if (riskyCount >= 3) return "HIGH";
  if (combined_prob == null || !Number.isFinite(combined_prob)) return "HIGH";
  if (combined_prob < COMBINED_HIGH) return "HIGH";
  if (combined_prob <= COMBINED_MEDIUM) return "Medium";
  if (bets <= 2) return "Very Low";
  return "Low";
}

function kickoffFor(
  matchId: string,
  logById: Record<string, LogMatch>,
  batchDate: string
): string {
  const m = logById[matchId];
  const raw = m?.matchDate?.trim() || batchDate?.trim() || "";
  if (!raw) return FILL_FROM_DB;
  return raw;
}

function survivalScore(r: TwoHHeavyResult): number {
  // Missing → treat as weakest (dropped first).
  if (!isFiniteProb(r.p_2h_gt_1h) || !Number.isFinite(r.confidence)) return -1;
  return r.p_2h_gt_1h * r.confidence;
}

/**
 * Build round-reduction ladder from 2H-heavy rankings.
 * Selection: top min(10,N) by p_2h_gt_1h desc (confidence tiebreak).
 * Drop order: ascending survival = p × confidence (weakest dropped first).
 */
export function buildLadder(params: {
  ranked: TwoHHeavyResult[];
  batch: PredictionBatch;
  maxLegs?: number;
}): LadderResult {
  const maxLegs = params.maxLegs ?? MAX_LEGS;
  const logById: Record<string, LogMatch> = {};
  for (const m of params.batch.matches) logById[m.id] = m;

  const sorted = [...params.ranked].sort(compareTwoHHeavy);
  const selected = sorted.slice(0, Math.min(maxLegs, sorted.length));
  const n = selected.length;

  const shortfallNotice =
    sorted.length < maxLegs
      ? `Only ${sorted.length} ranked match${sorted.length === 1 ? "" : "es"} available — building a ${n}-round ladder (not padded).`
      : null;

  if (n === 0) {
    return {
      matches: [],
      rounds: [],
      dropOrder: [],
      shortfallNotice: shortfallNotice ?? "No ranked matches in this batch.",
      n: 0,
    };
  }

  const dropOrdered = [...selected].sort((a, b) => {
    const sa = survivalScore(a);
    const sb = survivalScore(b);
    if (sa !== sb) return sa - sb;
    return a.p_2h_gt_1h - b.p_2h_gt_1h;
  });

  const letterById = new Map<string, string>();
  const dropOrder: string[] = [];
  dropOrdered.forEach((r, i) => {
    const L = letterAt(i);
    letterById.set(r.matchId, L);
    dropOrder.push(L);
  });

  const matches: LadderMatch[] = dropOrdered.map((r) => {
    const p = isFiniteProb(r.p_2h_gt_1h) ? r.p_2h_gt_1h : null;
    const c = Number.isFinite(r.confidence) ? r.confidence : null;
    const survival = p != null && c != null ? p * c : null;
    const log = logById[r.matchId];
    return {
      matchId: r.matchId,
      homeTeam: r.homeTeam || log?.homeTeam || FILL_FROM_DB,
      awayTeam: r.awayTeam || log?.awayTeam || FILL_FROM_DB,
      kickoff: kickoffFor(r.matchId, logById, params.batch.date),
      p2h_gt_1h: p,
      p2h_display: formatProb(p),
      confidence: c,
      confidence_display: formatProb(c),
      survival,
      letter: letterById.get(r.matchId)!,
      apiFixtureId: log?.apiFixtureId,
    };
  });

  const matchById = new Map(matches.map((m) => [m.matchId, m]));

  const rounds: LadderRound[] = [];
  for (let k = 1; k <= n; k++) {
    const kept = dropOrdered.slice(k - 1);
    const keptStrongFirst = [...kept].reverse();
    const legIds = keptStrongFirst.map((r) => r.matchId);
    const legLetters = keptStrongFirst.map((r) => letterById.get(r.matchId)!);

    let combined: number | null = 1;
    for (const r of kept) {
      if (!isFiniteProb(r.p_2h_gt_1h)) {
        combined = null;
        break;
      }
      combined *= r.p_2h_gt_1h;
    }

    const risky: string[] = [];
    for (const r of keptStrongFirst) {
      const m = matchById.get(r.matchId)!;
      if (m.p2h_gt_1h == null || m.p2h_gt_1h < RISK_THRESHOLD) {
        risky.push(m.letter);
      }
    }

    const bets = kept.length;
    const exposure = riskExposureFor({
      combined_prob: combined,
      bets,
      riskyCount: risky.length,
    });

    let legsSummary: string;
    if (k === 1) legsSummary = "all";
    else if (k === n) legsSummary = "best only";
    else legsSummary = `drop weakest ${k - 1}`;

    rounds.push({
      round: k,
      label: `R${k}`,
      bets,
      legIds,
      legLetters,
      legsSummary,
      risky_matches: risky,
      risky_display: risky.length ? risky.join(", ") : "—",
      combined_prob: combined,
      combined_display: formatProb(combined),
      risk_exposure: exposure,
    });
  }

  return { matches, rounds, dropOrder, shortfallNotice, n };
}

export function legsForRound(
  ladder: LadderResult,
  round: LadderRound
): LadderMatch[] {
  const byId = new Map(ladder.matches.map((m) => [m.matchId, m]));
  return round.legIds
    .map((id) => byId.get(id))
    .filter((m): m is LadderMatch => m != null);
}

// Re-export thresholds for tests/UI docs
export { COMBINED_HIGH, COMBINED_MEDIUM, RISK_THRESHOLD, FILL_FROM_DB, MAX_LEGS };
