import type { TwoHHeavyResult } from "@/lib/prediction-log/two-h-heavy";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { compareTwoHHeavy } from "@/lib/prediction-log/two-h-heavy";
import {
  COMBINED_HIGH,
  COMBINED_MEDIUM,
  FILL_FROM_DB,
  LADDER_CONFIG,
  MAX_LEGS,
  RISK_THRESHOLD,
} from "./config";

export type RiskExposure = "HIGH" | "Medium" | "Low" | "Very Low";

export interface LadderMatch {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
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

export interface LadderSelectionAudit {
  confFloor: number;
  maxPerLeagueInitial: number;
  maxPerLeagueUsed: number;
  qualifiedCount: number;
  selectedCount: number;
  leagueCounts: Record<string, number>;
  /** Why the per-league cap was raised, if at all. */
  relaxReason: string | null;
}

export interface LadderResult {
  matches: LadderMatch[];
  rounds: LadderRound[];
  /** Drop order letters A.. (weakest first). */
  dropOrder: string[];
  shortfallNotice: string | null;
  n: number;
  selection: LadderSelectionAudit;
}

export type BuildLadderOpts = {
  ranked: TwoHHeavyResult[];
  batch: PredictionBatch;
  /** @deprecated Prefer ladderSize */
  maxLegs?: number;
  ladderSize?: number;
  confFloor?: number;
  maxPerLeague?: number;
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

function survivalScore(r: TwoHHeavyResult): number {
  // Missing → treat as weakest (dropped first).
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

/**
 * Floor-safe greedy fill with per-league cap that relaxes only among
 * conf >= floor matches. Pool walked in compareTwoHHeavy order so
 * maxPerLeague >= ladderSize matches old global top-N.
 */
export function selectDiversifiedLegs(
  ranked: TwoHHeavyResult[],
  opts: {
    ladderSize: number;
    confFloor: number;
    maxPerLeague: number;
  }
): {
  selected: TwoHHeavyResult[];
  qualifiedCount: number;
  maxPerLeagueUsed: number;
  relaxReason: string | null;
  leagueCounts: Record<string, number>;
} {
  const { ladderSize, confFloor, maxPerLeague: initialCap } = opts;
  const eligible = ranked
    .filter((r) => Number.isFinite(r.confidence) && r.confidence >= confFloor)
    .sort(compareTwoHHeavy);

  const qualifiedCount = eligible.length;
  if (qualifiedCount === 0) {
    return {
      selected: [],
      qualifiedCount: 0,
      maxPerLeagueUsed: initialCap,
      relaxReason: null,
      leagueCounts: {},
    };
  }

  let cap = Math.max(1, initialCap);
  let selected: TwoHHeavyResult[] = [];
  let maxPerLeagueUsed = cap;
  let relaxReason: string | null = null;

  while (selected.length < ladderSize && cap <= ladderSize) {
    selected = [];
    const leagueCounts: Record<string, number> = {};
    const overflow: TwoHHeavyResult[] = [];

    for (const r of eligible) {
      if (selected.length >= ladderSize) break;
      const lg = leagueKey(r);
      const n = leagueCounts[lg] ?? 0;
      if (n < cap) {
        selected.push(r);
        leagueCounts[lg] = n + 1;
      } else {
        overflow.push(r);
      }
    }

    maxPerLeagueUsed = cap;

    if (selected.length >= ladderSize || overflow.length === 0) {
      if (cap > initialCap) {
        relaxReason = `Raised max-per-league from ${initialCap} to ${cap} to fill slots using only matches with conf ≥ ${confFloor}.`;
      }
      break;
    }

    // Need more slots and overflow remains — relax cap among floor-passers only.
    if (cap >= ladderSize) break;
    cap += 1;
    if (cap > initialCap) {
      relaxReason = `Raised max-per-league from ${initialCap} to ${cap} to fill slots using only matches with conf ≥ ${confFloor}.`;
    }
  }

  return {
    selected,
    qualifiedCount,
    maxPerLeagueUsed,
    relaxReason,
    leagueCounts: countLeagues(selected),
  };
}

/**
 * Drop order: ascending survival = p × confidence.
 * Within TIE_BAND, drop the match from the most-represented league first.
 */
export function sortDropOrder(
  selected: TwoHHeavyResult[],
  tieBand: number
): TwoHHeavyResult[] {
  const leagueCounts = countLeagues(selected);
  return [...selected].sort((a, b) => {
    const sa = survivalScore(a);
    const sb = survivalScore(b);
    if (Math.abs(sa - sb) > tieBand) return sa - sb;
    // Near-equal survival: thin the most-represented league first.
    const ca = leagueCounts[leagueKey(a)] ?? 0;
    const cb = leagueCounts[leagueKey(b)] ?? 0;
    if (ca !== cb) return cb - ca;
    return a.p_2h_gt_1h - b.p_2h_gt_1h;
  });
}

/**
 * Build round-reduction ladder from 2H-heavy rankings.
 * Selection: conf floor → greedy per-league fill (relax among floor-passers).
 * Drop order: ascending survival = p × confidence, TIE_BAND league thinning.
 */
export function buildLadder(params: BuildLadderOpts): LadderResult {
  const ladderSize =
    params.ladderSize ?? params.maxLegs ?? LADDER_CONFIG.LADDER_SIZE;
  const confFloor = params.confFloor ?? LADDER_CONFIG.CONF_FLOOR;
  const maxPerLeague = params.maxPerLeague ?? LADDER_CONFIG.MAX_PER_LEAGUE;
  const tieBand = params.tieBand ?? LADDER_CONFIG.TIE_BAND;

  const logById: Record<string, LogMatch> = {};
  for (const m of params.batch.matches) logById[m.id] = m;

  const pick = selectDiversifiedLegs(params.ranked, {
    ladderSize,
    confFloor,
    maxPerLeague,
  });
  const selected = pick.selected;
  const n = selected.length;

  const emptyAudit: LadderSelectionAudit = {
    confFloor,
    maxPerLeagueInitial: maxPerLeague,
    maxPerLeagueUsed: pick.maxPerLeagueUsed,
    qualifiedCount: pick.qualifiedCount,
    selectedCount: n,
    leagueCounts: pick.leagueCounts,
    relaxReason: pick.relaxReason,
  };

  let shortfallNotice: string | null = null;
  if (pick.qualifiedCount === 0) {
    shortfallNotice =
      "Only 0 matches met the confidence floor today — ladder built with 0. Lower the floor only if you accept weaker picks.";
  } else if (n < ladderSize) {
    shortfallNotice = `Only ${n} match${n === 1 ? "" : "es"} met the confidence floor today — ladder built with ${n}. Lower the floor only if you accept weaker picks.`;
  }

  if (n === 0) {
    return {
      matches: [],
      rounds: [],
      dropOrder: [],
      shortfallNotice:
        shortfallNotice ?? "No ranked matches in this batch.",
      n: 0,
      selection: emptyAudit,
    };
  }

  const dropOrdered = sortDropOrder(selected, tieBand);

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

  return {
    matches,
    rounds,
    dropOrder,
    shortfallNotice,
    n,
    selection: emptyAudit,
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
};
