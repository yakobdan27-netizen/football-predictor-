/**
 * Conceded Half Analysis — defensive mirror of half scoring.
 *
 * Aggregates goals conceded by half from batch teamStats (opponent HT/FT).
 * Advisory-only match blend (0.5 scored + 0.5 opp conceded) — never blocks picks.
 * Does not alter Half-Comparison Stage A.
 */
import { poissonPmf } from "@/lib/predictor/poisson";
import { standardizeTeamName } from "@/lib/data/team-names";
import {
  HALF_BASELINE_SAMPLE_THRESHOLD,
  lookupClubHalfBaseline,
  lookupLeagueHalfBaseline,
  seasonFromDate,
} from "./half-goals-baselines";
import {
  blendSeedAndLive,
  lookupClubConcededBaseline,
  lookupClubConcededRecencyBlend,
  seedConfidence,
  allConcededHalfBaselines,
  type ConcededRecencyBlend,
} from "./conceded-half-baselines";
import { matchLeague } from "./match-league";
import type { LogMatch, PredictionBatch } from "./types";

export type ConcededVenue = "home" | "away";
export type DefensiveProfile = "Slow Starter" | "Late Collapser" | "Balanced Defence";
export type ConcededConfidence = "high" | "medium" | "low";
export type ConcededOutcome = "1h_greater" | "equal" | "2h_greater";

export interface ConcededMatchLogRow {
  matchId: string;
  team: string;
  opponent: string;
  league: string;
  season: string;
  homeAway: "H" | "A";
  conceded1h: number;
  conceded2h: number;
  concededTotal: number;
  scored1h: number;
  scored2h: number;
  matchDate: string;
}

export interface ConcededHalfTeamStats {
  team: string;
  league: string;
  season: string | "all";
  matchesPlayed: number;
  totalConceded: number;
  avgConceded: number;
  avg1hConceded: number;
  avg2hConceded: number;
  conc1hGt2hPct: number;
  conc1hEq2hPct: number;
  conc2hGt1hPct: number;
  cleanSheet1hPct: number;
  cleanSheet2hPct: number;
  profile: DefensiveProfile;
  confidence: ConcededConfidence;
  dominantPct: number;
  /** Present when seed prior contributed to the row. */
  seedSource?: string | null;
  liveMatches?: number;
  seedMatches?: number;
}

export interface ConcededHalfPrediction {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  expHome1h: number;
  expHome2h: number;
  expAway1h: number;
  expAway2h: number;
  lambda1h: number;
  lambda2h: number;
  p1hGreater: number;
  pEqual: number;
  p2hGreater: number;
  recommendation: ConcededOutcome;
  topProbability: number;
  confidence: ConcededConfidence;
  sampleSizeHome: number;
  sampleSizeAway: number;
  detail: {
    homeAvg1hScored: number;
    homeAvg2hScored: number;
    awayAvg1hScored: number;
    awayAvg2hScored: number;
    homeAvg1hConceded: number;
    homeAvg2hConceded: number;
    awayAvg1hConceded: number;
    awayAvg2hConceded: number;
    usedVenueSplitHome: boolean;
    usedVenueSplitAway: boolean;
    coldStartNote: string | null;
    seedBlendHome?: string | null;
    seedBlendAway?: string | null;
  };
}

const POISSON_GRID_MAX_GOALS = 5;
const PROFILE_RATIO = 1.15;
const VENUE_SAMPLE_MIN = HALF_BASELINE_SAMPLE_THRESHOLD;

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

interface SideHalfGoals {
  ft: number;
  ht: number;
}

function sideHalfGoals(match: LogMatch, venue: ConcededVenue): SideHalfGoals | null {
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
  return { ft: ownFt, ht: ownHt };
}

/** Virtual per-team concede rows from settled batch HT/FT. */
export function buildConcededMatchLog(batches: PredictionBatch[]): ConcededMatchLogRow[] {
  const out: ConcededMatchLogRow[] = [];
  for (const batch of batches) {
    for (const match of batch.matches) {
      const home = sideHalfGoals(match, "home");
      const away = sideHalfGoals(match, "away");
      if (!home || !away) continue;
      const matchDate = match.matchDate ?? batch.date;
      const season = seasonFromDate(matchDate) ?? "unknown";
      const league = matchLeague(match, batch.league);
      const homeConc1h = away.ht;
      const homeConc2h = Math.max(0, away.ft - away.ht);
      const awayConc1h = home.ht;
      const awayConc2h = Math.max(0, home.ft - home.ht);
      out.push({
        matchId: match.id,
        team: match.homeTeam,
        opponent: match.awayTeam,
        league,
        season,
        homeAway: "H",
        conceded1h: homeConc1h,
        conceded2h: homeConc2h,
        concededTotal: homeConc1h + homeConc2h,
        scored1h: home.ht,
        scored2h: Math.max(0, home.ft - home.ht),
        matchDate,
      });
      out.push({
        matchId: match.id,
        team: match.awayTeam,
        opponent: match.homeTeam,
        league,
        season,
        homeAway: "A",
        conceded1h: awayConc1h,
        conceded2h: awayConc2h,
        concededTotal: awayConc1h + awayConc2h,
        scored1h: away.ht,
        scored2h: Math.max(0, away.ft - away.ht),
        matchDate,
      });
    }
  }
  return out;
}

export function defensiveProfile(avg1h: number, avg2h: number): DefensiveProfile {
  if (avg1h > avg2h * PROFILE_RATIO) return "Slow Starter";
  if (avg2h > avg1h * PROFILE_RATIO) return "Late Collapser";
  return "Balanced Defence";
}

/**
 * High — dominant half pattern ≥ 55% AND matches ≥ 30
 * Medium — pattern 45–55% OR matches 15–29
 * Low — matches < 15
 */
export function confidenceBand(dominantPct: number, matchesPlayed: number): ConcededConfidence {
  if (matchesPlayed < 15) return "low";
  if (dominantPct >= 55 && matchesPlayed >= 30) return "high";
  if ((dominantPct >= 45 && dominantPct < 55) || (matchesPlayed >= 15 && matchesPlayed < 30)) {
    return "medium";
  }
  if (dominantPct >= 55 && matchesPlayed >= 15) return "medium";
  return "low";
}

function resolveSeedForAggregate(
  club: string,
  league: string,
  seasonFilter: string | "all"
): ConcededRecencyBlend | null {
  if (seasonFilter === "all") {
    return lookupClubConcededRecencyBlend(club, league);
  }
  const row = lookupClubConcededBaseline(club, league, seasonFilter);
  if (!row) return null;
  return {
    clubName: standardizeTeamName(row.clubName),
    league: row.league,
    seasonCount: 1,
    avgConceded: row.avgConceded,
    avg1hConceded: row.avg1hConceded,
    avg2hConceded: row.avg2hConceded,
    pct1hGt2h: row.pct1hGt2h,
    pct1hEq2h: row.pct1hEq2h,
    pct2hGt1h: row.pct2hGt1h,
    seedMatches: row.matches,
    sourceLabel: `seed: ${standardizeTeamName(row.clubName)} ${row.season}`,
  };
}

export function aggregateConcededHalfStats(
  rows: ConcededMatchLogRow[],
  opts?: { league?: string | null; season?: string | "all" | null }
): ConcededHalfTeamStats[] {
  const leagueFilter = opts?.league?.trim() || null;
  const seasonFilter = opts?.season ?? "all";

  const filtered = rows.filter((r) => {
    if (leagueFilter && r.league !== leagueFilter) return false;
    if (seasonFilter && seasonFilter !== "all" && r.season !== seasonFilter) return false;
    return true;
  });

  const groups = new Map<string, ConcededMatchLogRow[]>();
  for (const row of filtered) {
    const key =
      seasonFilter === "all"
        ? `${teamKey(row.team)}|${row.league}|all`
        : `${teamKey(row.team)}|${row.league}|${row.season}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const stats: ConcededHalfTeamStats[] = [];
  const seenKeys = new Set<string>();

  for (const list of groups.values()) {
    const n = list.length;
    if (n === 0) continue;
    const first = list[0]!;
    const groupKey =
      seasonFilter === "all"
        ? `${teamKey(first.team)}|${first.league}|all`
        : `${teamKey(first.team)}|${first.league}|${first.season}`;
    seenKeys.add(groupKey);

    let totalConc = 0;
    let sum1h = 0;
    let sum2h = 0;
    let gt = 0;
    let eq = 0;
    let lt = 0;
    let cs1 = 0;
    let cs2 = 0;
    for (const r of list) {
      totalConc += r.concededTotal;
      sum1h += r.conceded1h;
      sum2h += r.conceded2h;
      if (r.conceded1h > r.conceded2h) gt += 1;
      else if (r.conceded1h === r.conceded2h) eq += 1;
      else lt += 1;
      if (r.conceded1h === 0) cs1 += 1;
      if (r.conceded2h === 0) cs2 += 1;
    }
    const liveAvg1h = sum1h / n;
    const liveAvg2h = sum2h / n;
    const liveAvg = totalConc / n;
    const liveP1 = (100 * gt) / n;
    const livePe = (100 * eq) / n;
    const liveP2 = (100 * lt) / n;

    const seed = resolveSeedForAggregate(first.team, first.league, seasonFilter);
    const seedN = seed?.seedMatches ?? 0;
    const avg1h = seed
      ? blendSeedAndLive(seed.avg1hConceded, seedN, liveAvg1h, n)
      : liveAvg1h;
    const avg2h = seed
      ? blendSeedAndLive(seed.avg2hConceded, seedN, liveAvg2h, n)
      : liveAvg2h;
    const avgConceded = seed
      ? blendSeedAndLive(seed.avgConceded, seedN, liveAvg, n)
      : liveAvg;
    const conc1hGt2hPct = seed
      ? blendSeedAndLive(seed.pct1hGt2h, seedN, liveP1, n)
      : liveP1;
    const conc1hEq2hPct = seed
      ? blendSeedAndLive(seed.pct1hEq2h, seedN, livePe, n)
      : livePe;
    const conc2hGt1hPct = seed
      ? blendSeedAndLive(seed.pct2hGt1h, seedN, liveP2, n)
      : liveP2;
    const dominantPct = Math.max(conc1hGt2hPct, conc1hEq2hPct, conc2hGt1hPct);
    const conf = seed
      ? seedConfidence(seed, n)
      : confidenceBand(dominantPct, n);

    stats.push({
      team: standardizeTeamName(first.team),
      league: first.league,
      season: seasonFilter === "all" ? "all" : first.season,
      matchesPlayed: Math.round(n + seedN),
      totalConceded: avgConceded * (n + seedN),
      avgConceded,
      avg1hConceded: avg1h,
      avg2hConceded: avg2h,
      conc1hGt2hPct,
      conc1hEq2hPct,
      conc2hGt1hPct,
      cleanSheet1hPct: (100 * cs1) / n,
      cleanSheet2hPct: (100 * cs2) / n,
      profile: defensiveProfile(avg1h, avg2h),
      confidence: conf,
      dominantPct,
      seedSource: seed?.sourceLabel ?? null,
      liveMatches: n,
      seedMatches: seedN || undefined,
    });
  }

  // Seed-only clubs with no live HT rows for this filter
  const seedRows = allConcededHalfBaselines().filter((r) => {
    if (leagueFilter && r.league !== leagueFilter) return false;
    if (seasonFilter !== "all" && r.season !== seasonFilter) return false;
    return true;
  });

  if (seasonFilter === "all") {
    const clubs = new Map<string, { club: string; league: string }>();
    for (const r of seedRows) {
      clubs.set(`${teamKey(r.clubName)}|${r.league}`, {
        club: r.clubName,
        league: r.league,
      });
    }
    for (const { club, league } of clubs.values()) {
      const key = `${teamKey(club)}|${league}|all`;
      if (seenKeys.has(key)) continue;
      const seed = lookupClubConcededRecencyBlend(club, league);
      if (!seed) continue;
      stats.push(seedOnlyStatsRow(seed, "all"));
    }
  } else {
    for (const r of seedRows) {
      const key = `${teamKey(r.clubName)}|${r.league}|${r.season}`;
      if (seenKeys.has(key)) continue;
      const seed = resolveSeedForAggregate(r.clubName, r.league, r.season);
      if (!seed) continue;
      stats.push(seedOnlyStatsRow(seed, r.season));
    }
  }

  stats.sort(
    (a, b) => b.avgConceded - a.avgConceded || a.team.localeCompare(b.team)
  );
  return stats;
}

function seedOnlyStatsRow(
  seed: ConcededRecencyBlend,
  season: string | "all"
): ConcededHalfTeamStats {
  const dominantPct = Math.max(seed.pct1hGt2h, seed.pct1hEq2h, seed.pct2hGt1h);
  return {
    team: seed.clubName,
    league: seed.league,
    season,
    matchesPlayed: Math.round(seed.seedMatches),
    totalConceded: seed.avgConceded * seed.seedMatches,
    avgConceded: seed.avgConceded,
    avg1hConceded: seed.avg1hConceded,
    avg2hConceded: seed.avg2hConceded,
    conc1hGt2hPct: seed.pct1hGt2h,
    conc1hEq2hPct: seed.pct1hEq2h,
    conc2hGt1hPct: seed.pct2hGt1h,
    cleanSheet1hPct: 0,
    cleanSheet2hPct: 0,
    profile: defensiveProfile(seed.avg1hConceded, seed.avg2hConceded),
    confidence: seedConfidence(seed, 0),
    dominantPct,
    seedSource: seed.sourceLabel,
    liveMatches: 0,
    seedMatches: seed.seedMatches,
  };
}

export function listSeasonsFromLog(rows: ConcededMatchLogRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.season && r.season !== "unknown") set.add(r.season);
  }
  for (const r of allConcededHalfBaselines()) set.add(r.season);
  return [...set].sort().reverse();
}

export function listLeaguesFromLog(rows: ConcededMatchLogRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.league) set.add(r.league);
  }
  for (const r of allConcededHalfBaselines()) set.add(r.league);
  return [...set].sort();
}

interface TeamHalfRates {
  sample: number;
  avg1hScored: number;
  avg2hScored: number;
  avg1hConceded: number;
  avg2hConceded: number;
  cs1hRate: number;
  cs2hRate: number;
  usedVenueSplit: boolean;
  coldStart: boolean;
  seedBlended: boolean;
  seedNote: string | null;
  seedMatches: number;
}

function computeTeamRates(
  rows: ConcededMatchLogRow[],
  team: string,
  venue: ConcededVenue | "any",
  opts?: { beforeDate?: string; league?: string }
): TeamHalfRates {
  const key = teamKey(team);
  const league = opts?.league ?? "";
  const season = seasonFromDate(opts?.beforeDate);
  const venueCode = venue === "home" ? "H" : venue === "away" ? "A" : null;
  let filtered = rows.filter((r) => {
    if (teamKey(r.team) !== key) return false;
    if (opts?.league && r.league !== opts.league) return false;
    if (opts?.beforeDate && r.matchDate >= opts.beforeDate) return false;
    if (venueCode && r.homeAway !== venueCode) return false;
    return true;
  });

  let usedVenueSplit = venue !== "any";
  if (venue !== "any" && filtered.length < VENUE_SAMPLE_MIN) {
    filtered = rows.filter((r) => {
      if (teamKey(r.team) !== key) return false;
      if (opts?.league && r.league !== opts.league) return false;
      if (opts?.beforeDate && r.matchDate >= opts.beforeDate) return false;
      return true;
    });
    usedVenueSplit = false;
  }

  const n = filtered.length;
  const seed = league ? lookupClubConcededRecencyBlend(team, league) : null;
  const seedN = seed?.seedMatches ?? 0;

  // Scored cold-start from scoring baselines when no live samples
  const scoringRow = league ? lookupClubHalfBaseline(team, league, season) : null;
  const leagueScore = league ? lookupLeagueHalfBaseline(league, season) : null;

  if (n === 0) {
    const scored1h = scoringRow?.avg1h ?? (leagueScore ? leagueScore.avg1h / 2 : 0.55);
    const scored2h = scoringRow?.avg2h ?? (leagueScore ? leagueScore.avg2h / 2 : 0.75);
    const conc1h = seed?.avg1hConceded ?? scored1h;
    const conc2h = seed?.avg2hConceded ?? scored2h;
    return {
      sample: 0,
      avg1hScored: scored1h,
      avg2hScored: scored2h,
      avg1hConceded: conc1h,
      avg2hConceded: conc2h,
      cs1hRate: 0,
      cs2hRate: 0,
      usedVenueSplit: false,
      coldStart: true,
      seedBlended: !!seed,
      seedNote: seed
        ? `seed blend: ${seed.clubName} (n_seed≈${Math.round(seed.seedMatches)}, n_live=0)`
        : "Thin HT history — league/scoring proxies",
      seedMatches: seedN,
    };
  }

  const avg = (pick: (r: ConcededMatchLogRow) => number) =>
    filtered.reduce((a, r) => a + pick(r), 0) / n;
  const live1hC = avg((r) => r.conceded1h);
  const live2hC = avg((r) => r.conceded2h);
  const live1hS = avg((r) => r.scored1h);
  const live2hS = avg((r) => r.scored2h);
  const cs1 = filtered.filter((r) => r.conceded1h === 0).length / n;
  const cs2 = filtered.filter((r) => r.conceded2h === 0).length / n;

  const avg1hConceded = seed
    ? blendSeedAndLive(seed.avg1hConceded, seedN, live1hC, n)
    : live1hC;
  const avg2hConceded = seed
    ? blendSeedAndLive(seed.avg2hConceded, seedN, live2hC, n)
    : live2hC;

  return {
    sample: n,
    avg1hScored: live1hS,
    avg2hScored: live2hS,
    avg1hConceded,
    avg2hConceded,
    cs1hRate: cs1,
    cs2hRate: cs2,
    usedVenueSplit,
    coldStart: false,
    seedBlended: !!seed && seedN > 0,
    seedNote:
      seed && seedN > 0
        ? `seed blend: ${seed.clubName} (n_seed≈${Math.round(seedN)}, n_live=${n})`
        : null,
    seedMatches: seedN,
  };
}

function poissonHalfCompare(
  lambda1h: number,
  lambda2h: number
): { p1hGreater: number; pEqual: number; p2hGreater: number } {
  const pmf1 = Array.from({ length: POISSON_GRID_MAX_GOALS + 1 }, (_, g) =>
    poissonPmf(g, Math.max(0, lambda1h))
  );
  const pmf2 = Array.from({ length: POISSON_GRID_MAX_GOALS + 1 }, (_, g) =>
    poissonPmf(g, Math.max(0, lambda2h))
  );
  let p1hGreater = 0;
  let pEqual = 0;
  let p2hGreater = 0;
  for (let g1 = 0; g1 <= POISSON_GRID_MAX_GOALS; g1++) {
    for (let g2 = 0; g2 <= POISSON_GRID_MAX_GOALS; g2++) {
      const p = pmf1[g1]! * pmf2[g2]!;
      if (g1 > g2) p1hGreater += p;
      else if (g2 > g1) p2hGreater += p;
      else pEqual += p;
    }
  }
  const total = p1hGreater + pEqual + p2hGreater;
  if (total <= 0) return { p1hGreater: 0, pEqual: 1, p2hGreater: 0 };
  return {
    p1hGreater: p1hGreater / total,
    pEqual: pEqual / total,
    p2hGreater: p2hGreater / total,
  };
}

function recommendationFromProbs(p: {
  p1hGreater: number;
  pEqual: number;
  p2hGreater: number;
}): ConcededOutcome {
  if (p.p2hGreater >= p.p1hGreater && p.p2hGreater >= p.pEqual) return "2h_greater";
  if (p.p1hGreater >= p.pEqual) return "1h_greater";
  return "equal";
}

/**
 * Module-local advisory: λ_A_1h = 0.5 * A scored 1H + 0.5 * B conceded 1H (etc.).
 * Never blocks.
 */
export function predictConcededHalfMatch(params: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  batches: PredictionBatch[];
  beforeDate?: string;
  logRows?: ConcededMatchLogRow[];
}): ConcededHalfPrediction {
  const rows = params.logRows ?? buildConcededMatchLog(params.batches);
  const homeRates = computeTeamRates(rows, params.homeTeam, "home", {
    beforeDate: params.beforeDate,
    league: params.league,
  });
  const awayRates = computeTeamRates(rows, params.awayTeam, "away", {
    beforeDate: params.beforeDate,
    league: params.league,
  });

  const expHome1h = 0.5 * homeRates.avg1hScored + 0.5 * awayRates.avg1hConceded;
  const expHome2h = 0.5 * homeRates.avg2hScored + 0.5 * awayRates.avg2hConceded;
  const expAway1h = 0.5 * awayRates.avg1hScored + 0.5 * homeRates.avg1hConceded;
  const expAway2h = 0.5 * awayRates.avg2hScored + 0.5 * homeRates.avg2hConceded;

  const lambda1h = Math.max(0.05, expHome1h + expAway1h);
  const lambda2h = Math.max(0.05, expHome2h + expAway2h);
  const probs = poissonHalfCompare(lambda1h, lambda2h);
  const recommendation = recommendationFromProbs(probs);
  const top = Math.max(probs.p1hGreater, probs.pEqual, probs.p2hGreater);
  const homeSeed = lookupClubConcededRecencyBlend(params.homeTeam, params.league);
  const awaySeed = lookupClubConcededRecencyBlend(params.awayTeam, params.league);
  const homeConf = seedConfidence(homeSeed, homeRates.sample);
  const awayConf = seedConfidence(awaySeed, awayRates.sample);
  const confRank = { low: 0, medium: 1, high: 2 } as const;
  const confidence: ConcededConfidence =
    confRank[homeConf] <= confRank[awayConf] ? homeConf : awayConf;

  const notes = [homeRates.seedNote, awayRates.seedNote].filter(Boolean);
  const coldStartNote = notes.length > 0 ? notes.join(" · ") : null;

  return {
    matchId: params.matchId,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    league: params.league,
    expHome1h,
    expHome2h,
    expAway1h,
    expAway2h,
    lambda1h,
    lambda2h,
    p1hGreater: probs.p1hGreater,
    pEqual: probs.pEqual,
    p2hGreater: probs.p2hGreater,
    recommendation,
    topProbability: top,
    confidence,
    sampleSizeHome: homeRates.sample,
    sampleSizeAway: awayRates.sample,
    detail: {
      homeAvg1hScored: homeRates.avg1hScored,
      homeAvg2hScored: homeRates.avg2hScored,
      awayAvg1hScored: awayRates.avg1hScored,
      awayAvg2hScored: awayRates.avg2hScored,
      homeAvg1hConceded: homeRates.avg1hConceded,
      homeAvg2hConceded: homeRates.avg2hConceded,
      awayAvg1hConceded: awayRates.avg1hConceded,
      awayAvg2hConceded: awayRates.avg2hConceded,
      usedVenueSplitHome: homeRates.usedVenueSplit,
      usedVenueSplitAway: awayRates.usedVenueSplit,
      coldStartNote,
      seedBlendHome: homeRates.seedNote,
      seedBlendAway: awayRates.seedNote,
    },
  };
}

export function recommendationLabel(outcome: ConcededOutcome): string {
  switch (outcome) {
    case "1h_greater":
      return "1H > 2H conceded lean";
    case "equal":
      return "Even halves";
    case "2h_greater":
      return "2H > 1H conceded lean";
  }
}

/** Clean-sheet rates for a team from the concede log (for ML feature stubs). */
export function teamCleanSheetRates(
  rows: ConcededMatchLogRow[],
  team: string,
  opts?: { beforeDate?: string; league?: string }
): { cs1hRate: number; cs2hRate: number; sample: number } {
  const rates = computeTeamRates(rows, team, "any", opts);
  return { cs1hRate: rates.cs1hRate, cs2hRate: rates.cs2hRate, sample: rates.sample };
}
