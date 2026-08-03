/**
 * Resolve per-team half intensities:
 * manual batch HT (N≥8) → hist (N≥8) → AF KV → seeds → league prior.
 * Never invents numbers; provenance on each profile.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import {
  isMatchHalfDataGap,
  partlyFromApiSources,
} from "../data-gap";
import { lookupClubConcededRecencyBlend } from "../conceded-half-baselines";
import {
  lookupClubScoringRecencyBlend,
  lookupLeagueHalfBaseline,
} from "../half-goals-baselines";
import { matchLeague } from "../match-league";
import type { LogMatch, PredictionBatch } from "../types";
import { leagueTotalFor, MIN_MATCHES } from "./config";
import {
  computeConfidence,
  computeHalfMus,
  isThinData,
  poissonHalfProbs,
} from "./poisson-half";
import {
  conditionOnRealized1h,
  isSecondHalfStatus,
} from "./live-condition";
import { worstSource } from "./rank";
import type {
  CachedTeamHalfProfile,
  MatchDataSource,
  TeamHalfProfile,
  TeamHalfSource,
  TwoHHeavyResult,
  VenueSide,
} from "./types";

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

interface HalfSample {
  date: string;
  sc1: number;
  sc2: number;
  conc1: number;
  conc2: number;
}

function sideHalfFromMatch(
  match: LogMatch,
  venue: VenueSide
): Omit<HalfSample, "date"> | null {
  const ts = match.teamStats;
  if (!ts) return null;
  const own = venue === "home" ? ts.home : ts.away;
  const opp = venue === "home" ? ts.away : ts.home;
  const ownFt = own?.goals;
  const ownHt = own?.firstHalfGoals;
  const oppFt = opp?.goals;
  const oppHt = opp?.firstHalfGoals;
  if (
    ownFt == null ||
    ownHt == null ||
    oppFt == null ||
    oppHt == null ||
    !Number.isFinite(ownFt) ||
    !Number.isFinite(ownHt) ||
    !Number.isFinite(oppFt) ||
    !Number.isFinite(oppHt)
  ) {
    return null;
  }
  return {
    sc1: ownHt,
    sc2: Math.max(0, ownFt - ownHt),
    conc1: oppHt,
    conc2: Math.max(0, oppFt - oppHt),
  };
}

function collectVenueSamples(
  batches: PredictionBatch[],
  team: string,
  venue: VenueSide,
  opts?: { beforeDate?: string; league?: string; limit?: number }
): HalfSample[] {
  const key = teamKey(team);
  const out: HalfSample[] = [];
  for (const batch of batches) {
    for (const match of batch.matches) {
      const matchDate = match.matchDate ?? batch.date;
      if (opts?.beforeDate && matchDate >= opts.beforeDate) continue;
      if (opts?.league && matchLeague(match, batch.league) !== opts.league) continue;
      const side = venue === "home" ? match.homeTeam : match.awayTeam;
      if (teamKey(side) !== key) continue;
      const half = sideHalfFromMatch(match, venue);
      if (!half) continue;
      out.push({ date: matchDate, ...half });
    }
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  const limit = opts?.limit ?? 20;
  return out.slice(0, limit);
}

function priorProfile(
  team: string,
  venue: VenueSide,
  league: string
): TeamHalfProfile {
  const total = leagueTotalFor(league);
  const leagueHalf = lookupLeagueHalfBaseline(league);
  const avg1 = leagueHalf?.avg1h ?? total * 0.45;
  const avg2 = leagueHalf?.avg2h ?? total * 0.55;
  // Team-level prior: half of match half total.
  return {
    team: standardizeTeamName(team),
    venue,
    sc_1h: avg1 / 2,
    sc_2h: avg2 / 2,
    conc_1h: avg1 / 2,
    conc_2h: avg2 / 2,
    n_matches: 0,
    last_match_date: null,
    source: "prior",
    formation: null,
  };
}

function fromCachedApi(
  team: string,
  venue: VenueSide,
  cached: CachedTeamHalfProfile,
  source: TeamHalfSource = "api"
): TeamHalfProfile {
  return {
    team: standardizeTeamName(team),
    venue,
    sc_1h: cached.sc_1h,
    sc_2h: cached.sc_2h,
    conc_1h: cached.conc_1h,
    conc_2h: cached.conc_2h,
    n_matches: cached.n_matches,
    last_match_date: cached.last_match_date,
    source,
    formation: cached.formation ?? null,
  };
}

function fromDbSeeds(
  team: string,
  venue: VenueSide,
  league: string,
  liveSamples: HalfSample[]
): TeamHalfProfile | null {
  const scoring = lookupClubScoringRecencyBlend(team, league);
  const conceded = lookupClubConcededRecencyBlend(team, league);

  if (liveSamples.length >= MIN_MATCHES) {
    const n = liveSamples.length;
    const avg = (pick: (s: HalfSample) => number) =>
      liveSamples.reduce((a, s) => a + pick(s), 0) / n;
    return {
      team: standardizeTeamName(team),
      venue,
      sc_1h: avg((s) => s.sc1),
      sc_2h: avg((s) => s.sc2),
      conc_1h: avg((s) => s.conc1),
      conc_2h: avg((s) => s.conc2),
      n_matches: n,
      last_match_date: liveSamples[0]?.date ?? null,
      source: "db",
      formation: null,
    };
  }

  if (!scoring && !conceded && liveSamples.length === 0) return null;

  // Prefer seeds; if thin live HT exists, still report live n for confidence honesty.
  const sc1 = scoring ? scoring.avg1h / 2 : conceded ? conceded.avg1hConceded : 0;
  const sc2 = scoring ? scoring.avg2h / 2 : conceded ? conceded.avg2hConceded : 0;
  const conc1 = conceded?.avg1hConceded ?? (scoring ? scoring.avg1h / 2 : 0);
  const conc2 = conceded?.avg2hConceded ?? (scoring ? scoring.avg2h / 2 : 0);

  if (!scoring && !conceded) {
    // Only thin live samples — use them with source db but low n.
    const n = liveSamples.length;
    if (n === 0) return null;
    const avg = (pick: (s: HalfSample) => number) =>
      liveSamples.reduce((a, s) => a + pick(s), 0) / n;
    return {
      team: standardizeTeamName(team),
      venue,
      sc_1h: avg((s) => s.sc1),
      sc_2h: avg((s) => s.sc2),
      conc_1h: avg((s) => s.conc1),
      conc_2h: avg((s) => s.conc2),
      n_matches: n,
      last_match_date: liveSamples[0]?.date ?? null,
      source: "db",
      formation: null,
    };
  }

  return {
    team: standardizeTeamName(team),
    venue,
    sc_1h: sc1,
    sc_2h: sc2,
    conc_1h: conc1,
    conc_2h: conc2,
    // Honest: live HT count when present; else 0 so thin-data warning fires for seed-only.
    n_matches: liveSamples.length,
    last_match_date: liveSamples[0]?.date ?? null,
    source: "db",
    formation: null,
  };
}

export interface ResolveProfileOpts {
  beforeDate?: string;
  /** Preloaded hist_* profiles keyed by `${teamKey}|${venue}` (prefer when N≥8). */
  histByKey?: Record<string, CachedTeamHalfProfile>;
  /** Preloaded API cache keyed by `${teamKey}|${venue}`. */
  apiByKey?: Record<string, CachedTeamHalfProfile>;
}

export function resolveTeamHalfProfile(
  team: string,
  venue: VenueSide,
  league: string,
  batches: PredictionBatch[],
  opts?: ResolveProfileOpts
): TeamHalfProfile {
  const key = `${teamKey(team)}|${venue}`;

  // Manual batch HT samples win when sample size is sufficient.
  const samples = collectVenueSamples(batches, team, venue, {
    beforeDate: opts?.beforeDate,
    league,
  });
  if (samples.length >= MIN_MATCHES) {
    const fromManual = fromDbSeeds(team, venue, league, samples);
    if (fromManual && fromManual.n_matches >= MIN_MATCHES) return fromManual;
  }

  const hist = opts?.histByKey?.[key];
  if (hist && hist.n_matches >= MIN_MATCHES) {
    return fromCachedApi(team, venue, hist, "hist");
  }

  const cached = opts?.apiByKey?.[key];
  if (cached && cached.n_matches > 0) {
    const src: TeamHalfSource =
      cached.source === "hist" ? "hist" : "api";
    return fromCachedApi(team, venue, cached, src);
  }

  // Thin live HT samples only — never treat JSON seed baselines as N≥8 evidence.
  if (samples.length > 0) {
    const n = samples.length;
    const avg = (pick: (s: HalfSample) => number) =>
      samples.reduce((a, s) => a + pick(s), 0) / n;
    return {
      team: standardizeTeamName(team),
      venue,
      sc_1h: avg((s) => s.sc1),
      sc_2h: avg((s) => s.sc2),
      conc_1h: avg((s) => s.conc1),
      conc_2h: avg((s) => s.conc2),
      n_matches: n,
      last_match_date: samples[0]?.date ?? null,
      source: "db",
      formation: null,
    };
  }

  return priorProfile(team, venue, league);
}

export interface LiveMatchContext {
  statusShort?: string | null;
  /** Realized 1H total goals. */
  realized_1h?: number | null;
  /** Goals scored so far in 2H. */
  goals_2h_so_far?: number | null;
  /** Elapsed minutes in 2H (0–45+). */
  elapsed_2h_minutes?: number | null;
}

export function predictTwoHHeavy(params: {
  match: LogMatch;
  batchLeague: string;
  batches: PredictionBatch[];
  beforeDate?: string;
  histByKey?: Record<string, CachedTeamHalfProfile>;
  apiByKey?: Record<string, CachedTeamHalfProfile>;
  live?: LiveMatchContext | null;
  nowMs?: number;
}): TwoHHeavyResult {
  const { match, batchLeague, batches } = params;
  const league = matchLeague(match, batchLeague);
  const homeProfile = resolveTeamHalfProfile(match.homeTeam, "home", league, batches, {
    beforeDate: params.beforeDate,
    histByKey: params.histByKey,
    apiByKey: params.apiByKey,
  });
  const awayProfile = resolveTeamHalfProfile(match.awayTeam, "away", league, batches, {
    beforeDate: params.beforeDate,
    histByKey: params.histByKey,
    apiByKey: params.apiByKey,
  });

  const mus = computeHalfMus(homeProfile, awayProfile, league);
  let probs = poissonHalfProbs(mus.mu_1h_final, mus.mu_2h_final);
  let live = false;
  let data_source: MatchDataSource = worstSource(homeProfile.source, awayProfile.source);

  const liveCtx = params.live;
  const realized1h = liveCtx?.realized_1h;
  if (
    liveCtx &&
    isSecondHalfStatus(liveCtx.statusShort) &&
    realized1h != null &&
    Number.isFinite(realized1h)
  ) {
    const conditioned = conditionOnRealized1h({
      realized_1h: realized1h,
      goals_2h_so_far: liveCtx.goals_2h_so_far ?? 0,
      mu_2h_final: mus.mu_2h_final,
      elapsed_2h_minutes: liveCtx.elapsed_2h_minutes,
    });
    probs = {
      p_2h_gt_1h: conditioned.p_2h_gt_1h,
      p_2h_eq_1h: conditioned.p_2h_eq_1h,
      p_2h_lt_1h: conditioned.p_2h_lt_1h,
      expected_1h: realized1h,
      expected_2h: conditioned.expected_2h,
    };
    live = true;
    data_source = "live";
  }

  const thinData = isThinData(homeProfile.n_matches, awayProfile.n_matches);
  const insufficientData = isMatchHalfDataGap(homeProfile, awayProfile);
  const partlyFromApi = partlyFromApiSources(
    homeProfile.source,
    awayProfile.source
  );

  const confidence = insufficientData
    ? 0
    : computeConfidence(
        probs.p_2h_gt_1h,
        homeProfile.n_matches,
        awayProfile.n_matches,
        homeProfile.last_match_date,
        awayProfile.last_match_date,
        params.nowMs
      );

  return {
    matchId: match.id,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    league,
    ...probs,
    confidence,
    data_source,
    thinData,
    partlyFromApi,
    insufficientData,
    homeProfile,
    awayProfile,
    live,
  };
}

export function predictBatchTwoHHeavy(
  batch: PredictionBatch,
  allBatches: PredictionBatch[],
  opts?: {
    histByKey?: Record<string, CachedTeamHalfProfile>;
    apiByKey?: Record<string, CachedTeamHalfProfile>;
    liveByMatchId?: Record<string, LiveMatchContext>;
    nowMs?: number;
  }
): TwoHHeavyResult[] {
  return batch.matches.map((match) =>
    predictTwoHHeavy({
      match,
      batchLeague: batch.league,
      batches: allBatches,
      beforeDate: batch.date,
      histByKey: opts?.histByKey,
      apiByKey: opts?.apiByKey,
      live: opts?.liveByMatchId?.[match.id] ?? null,
      nowMs: opts?.nowMs,
    })
  );
}

export function profileCacheKey(team: string, venue: VenueSide): string {
  return `${teamKey(team)}|${venue}`;
}

export type { TeamHalfSource };
