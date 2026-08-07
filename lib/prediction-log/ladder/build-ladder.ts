import type { TwoHHeavyResult } from "@/lib/prediction-log/two-h-heavy";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import {
  COMBINED_HIGH,
  COMBINED_MEDIUM,
  FILL_FROM_DB,
  LADDER_CONFIG,
  MAX_LEGS,
  RISK_THRESHOLD,
  labelTier,
  tierRank,
  type ConfTier,
} from "./config";

export type RiskExposure = "HIGH" | "Medium" | "Low" | "Very Low";

export interface LadderMatch {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  /** Quality label from conf — never used to exclude a match. */
  tier: ConfTier;
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
  /** Per-leg P(2H>1H) percents, strongest-first (e.g. "J 72.0% · I 68.1%"). */
  leg_percents_display: string;
  /** Risky letters (p < RISK_THRESHOLD) still included. */
  risky_matches: string[];
  risky_display: string;
  combined_prob: number | null;
  combined_display: string;
  risk_exposure: RiskExposure;
  suggestedStake?: number;
}

export type TierCounts = { A: number; B: number; C: number };

export interface LadderSelectionAudit {
  selectedCount: number;
  /** Matches with finite p and conf (rankable pool). */
  candidateCount: number;
  leagueCounts: Record<string, number>;
  maxPerLeague: number;
  /** Cap after auto-relax (may equal maxPerLeague if no relax needed). */
  relaxedTo: number;
  tierCounts: TierCounts;
}

export interface LadderResult {
  matches: LadderMatch[];
  rounds: LadderRound[];
  /** Drop order letters A.. (weakest first). */
  dropOrder: string[];
  /** Shown when fewer matches were entered than LADDER_SIZE. */
  shortfallNotice: string | null;
  /** Weak-day honesty when all selected legs are Tier C. */
  weakLadderNotice: string | null;
  /** One-line quality mix for UI summary. */
  qualitySummary: string | null;
  /** Plain-language "Why these 10?" body. */
  whyThese: string | null;
  n: number;
  selection: LadderSelectionAudit;
}

export type BuildLadderOpts = {
  ranked: TwoHHeavyResult[];
  batch: PredictionBatch;
  /** @deprecated Prefer ladderSize */
  maxLegs?: number;
  ladderSize?: number;
  /** Soft per-league cap; fully relaxes before returning short. */
  maxPerLeague?: number;
  /** rank_score window for league drop tie-break. */
  tieBand?: number;
};

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

/** rank_score = p × conf. */
export function rankScore(r: TwoHHeavyResult): number {
  if (!isFiniteProb(r.p_2h_gt_1h) || !Number.isFinite(r.confidence)) return -1;
  return r.p_2h_gt_1h * r.confidence;
}

function leagueKey(r: TwoHHeavyResult): string {
  return (r.league || "Unknown").trim() || "Unknown";
}

function countLeagues(selected: TwoHHeavyResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of selected) {
    const k = leagueKey(r);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function countTiers(selected: TwoHHeavyResult[]): TierCounts {
  const counts: TierCounts = { A: 0, B: 0, C: 0 };
  for (const r of selected) {
    counts[labelTier(r.confidence)] += 1;
  }
  return counts;
}

function compareRankScoreDesc(a: TwoHHeavyResult, b: TwoHHeavyResult): number {
  const sa = rankScore(a);
  const sb = rankScore(b);
  if (sb !== sa) return sb - sa;
  if (b.p_2h_gt_1h !== a.p_2h_gt_1h) return b.p_2h_gt_1h - a.p_2h_gt_1h;
  return b.confidence - a.confidence;
}

/**
 * Always-fill selection: sort by rank_score, greedy per-league cap,
 * then relax the cap until ladderSize is filled or the pool is exhausted.
 * Confidence never rejects a candidate.
 */
export function selectTopLegs(
  ranked: TwoHHeavyResult[],
  opts: {
    ladderSize: number;
    maxPerLeague?: number;
  }
): {
  selected: TwoHHeavyResult[];
  candidateCount: number;
  leagueCounts: Record<string, number>;
  maxPerLeague: number;
  relaxedTo: number;
  tierCounts: TierCounts;
} {
  const ladderSize = opts.ladderSize;
  const initialCap = Math.max(
    1,
    opts.maxPerLeague ?? LADDER_CONFIG.MAX_PER_LEAGUE
  );

  const candidates = ranked
    .filter(
      (r) => isFiniteProb(r.p_2h_gt_1h) && Number.isFinite(r.confidence)
    )
    .sort(compareRankScoreDesc);

  const selected: TwoHHeavyResult[] = [];
  const selectedIds = new Set<string>();
  let cap = initialCap;

  const tryFill = (currentCap: number) => {
    for (const r of candidates) {
      if (selected.length >= ladderSize) break;
      if (selectedIds.has(r.matchId)) continue;
      const league = leagueKey(r);
      const count = selected.filter((s) => leagueKey(s) === league).length;
      if (count < currentCap) {
        selected.push(r);
        selectedIds.add(r.matchId);
      }
    }
  };

  tryFill(cap);

  while (selected.length < ladderSize && selectedIds.size < candidates.length) {
    cap += 1;
    tryFill(cap);
  }

  return {
    selected,
    candidateCount: candidates.length,
    leagueCounts: countLeagues(selected),
    maxPerLeague: initialCap,
    relaxedTo: cap,
    tierCounts: countTiers(selected),
  };
}

/**
 * Drop order (weakest first): lower tier, then lower rank_score,
 * then (within TIE_BAND) most-represented league, then lower p.
 */
export function sortDropOrder(
  selected: TwoHHeavyResult[],
  opts?: { tieBand?: number; leagueCounts?: Record<string, number> }
): TwoHHeavyResult[] {
  const tieBand = opts?.tieBand ?? LADDER_CONFIG.TIE_BAND;
  const leagueCounts = opts?.leagueCounts ?? countLeagues(selected);

  return [...selected].sort((a, b) => {
    const ta = tierRank(labelTier(a.confidence));
    const tb = tierRank(labelTier(b.confidence));
    if (ta !== tb) return ta - tb;

    const sa = rankScore(a);
    const sb = rankScore(b);
    if (Math.abs(sa - sb) > tieBand) return sa - sb;

    const la = leagueCounts[leagueKey(a)] ?? 0;
    const lb = leagueCounts[leagueKey(b)] ?? 0;
    if (la !== lb) return lb - la;

    if (sa !== sb) return sa - sb;
    return a.p_2h_gt_1h - b.p_2h_gt_1h;
  });
}

function buildQualitySummary(n: number, tiers: TierCounts): string {
  return `${n} legs built — ${tiers.A} Tier A, ${tiers.B} Tier B, ${tiers.C} Tier C. Weaker legs (B/C) drop out first; only the strongest remain in the final rounds.`;
}

function buildWhyThese(n: number, ladderSize: number, tiers: TierCounts): string {
  const sizeNote =
    n < ladderSize
      ? `You entered ${n} matches, so the ladder has ${n} legs.`
      : `These are your ${n} highest-ranked matches by 2H-goal probability × confidence, then spread across leagues.`;
  return `${sizeNote} No match was filtered out by confidence — weaker ones are just labelled and dropped first. Tier mix: A ${tiers.A} · B ${tiers.B} · C ${tiers.C}.`;
}

/**
 * Build round-reduction ladder from 2H-heavy rankings.
 * Selection: rank_score top-N with soft per-league diversification (fully relaxes).
 * Drop order: tier → rank_score → league concentration within TIE_BAND.
 */
export function buildLadder(params: BuildLadderOpts): LadderResult {
  const ladderSize =
    params.ladderSize ?? params.maxLegs ?? LADDER_CONFIG.LADDER_SIZE;
  const maxPerLeague =
    params.maxPerLeague ?? LADDER_CONFIG.MAX_PER_LEAGUE;
  const tieBand = params.tieBand ?? LADDER_CONFIG.TIE_BAND;

  const logById: Record<string, LogMatch> = {};
  for (const m of params.batch.matches) logById[m.id] = m;

  const pick = selectTopLegs(params.ranked, {
    ladderSize,
    maxPerLeague,
  });
  const selected = pick.selected;
  const n = selected.length;
  const tierCounts = pick.tierCounts;

  const audit: LadderSelectionAudit = {
    selectedCount: n,
    candidateCount: pick.candidateCount,
    leagueCounts: pick.leagueCounts,
    maxPerLeague: pick.maxPerLeague,
    relaxedTo: pick.relaxedTo,
    tierCounts,
  };

  let shortfallNotice: string | null = null;
  if (pick.candidateCount === 0 || n === 0) {
    shortfallNotice =
      "You entered 0 matches, so the ladder has 0 legs. Enter at least 10 for a full ladder.";
  } else if (n < ladderSize) {
    shortfallNotice = `You entered ${n} matches, so the ladder has ${n} legs. Enter at least 10 for a full ladder.`;
  }

  const allWeak =
    n > 0 && tierCounts.A === 0 && tierCounts.B === 0 && tierCounts.C === n;
  const weakLadderNotice = allWeak
    ? "Today's ladder is weak — all legs are low confidence. It is still ranked best-to-worst, but treat it with caution."
    : null;

  const qualitySummary = n > 0 ? buildQualitySummary(n, tierCounts) : null;
  const whyThese = n > 0 ? buildWhyThese(n, ladderSize, tierCounts) : null;

  if (n === 0) {
    return {
      matches: [],
      rounds: [],
      dropOrder: [],
      shortfallNotice:
        shortfallNotice ?? "No ranked matches in this batch.",
      weakLadderNotice: null,
      qualitySummary: null,
      whyThese: null,
      n: 0,
      selection: audit,
    };
  }

  const dropOrdered = sortDropOrder(selected, {
    tieBand,
    leagueCounts: pick.leagueCounts,
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
      league: leagueKey(r),
      tier: c != null ? labelTier(c) : "C",
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

    const leg_percents_display = keptStrongFirst
      .map((r) => {
        const m = matchById.get(r.matchId)!;
        return `${m.letter} ${m.p2h_display}`;
      })
      .join(" · ");

    rounds.push({
      round: k,
      label: `R${k}`,
      bets,
      legIds,
      legLetters,
      legsSummary,
      leg_percents_display,
      risky_matches: risky,
      risky_display: risky.length ? risky.join(", ") : "—",
      combined_prob: combined,
      combined_display: formatProb(combined),
      risk_exposure: exposure,
    });
  }

  return {
    matches,
    rounds,
    dropOrder,
    shortfallNotice,
    weakLadderNotice,
    qualitySummary,
    whyThese,
    n,
    selection: audit,
  };
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

/** Short league label for distribution strip / tags. */
export function shortLeagueLabel(league: string): string {
  const map: Record<string, string> = {
    "Premier League": "EPL",
    "La Liga": "LaLiga",
    "Serie A": "SerieA",
    Bundesliga: "Bundesliga",
    "Ligue 1": "Ligue1",
  };
  return map[league] ?? league;
}

// Re-export thresholds for tests/UI docs
export {
  COMBINED_HIGH,
  COMBINED_MEDIUM,
  RISK_THRESHOLD,
  FILL_FROM_DB,
  MAX_LEGS,
  LADDER_CONFIG,
  labelTier,
  tierRank,
} from "./config";
