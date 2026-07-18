/**
 * Corners analysis — both-club won × conceded interaction + Poisson O/U.
 * Advisory only; never blocks picks. Does not alter Recommendation corners_ou.
 */
import { poissonPmf } from "@/lib/predictor/poisson";
import { standardizeTeamName } from "@/lib/data/team-names";
import {
  blendSeedAndLive,
  cornersSeedConfidence,
  lookupClubCornersRecencyBlend,
  lookupLeagueCornersBaseline,
  listCornersSeedClubs,
  listCornersSeedSeasons,
  type CornersBaselineRow,
  type CornersSeedConfidence,
} from "./corners-baselines";
import { matchLeague } from "./match-league";
import type { LogMatch, PredictionBatch } from "./types";

export type CornersConfidence = CornersSeedConfidence;
export type CornersLean = "over_9.5" | "under_9.5" | "lean_none";

export interface ClubCornersRates {
  clubName: string;
  league: string;
  won: number;
  conceded: number;
  nMatches: number;
  seasonCount: number;
  seedOnly: boolean;
  sourceNote: string | null;
  liveMatches: number;
}

export interface CornersMatchPrediction {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  lambdaHome: number;
  lambdaAway: number;
  expectedTotal: number;
  pOver95: number;
  pUnder95: number;
  pOver105: number;
  pUnder105: number;
  pHomeOver45: number;
  pAwayOver45: number;
  lean: CornersLean;
  topProbability: number;
  confidence: CornersConfidence;
  detail: {
    homeWon: number;
    homeConceded: number;
    awayWon: number;
    awayConceded: number;
    leagueBase: number;
    seedHome: string | null;
    seedAway: string | null;
  };
}

const POISSON_GRID_MAX = 25;
const DEFAULT_LEAGUE_BASE = 5.2;

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

function sideCorners(
  match: LogMatch,
  venue: "home" | "away"
): { won: number; conceded: number } | null {
  const ts = match.teamStats;
  if (!ts) return null;
  const own = venue === "home" ? ts.home : ts.away;
  const opp = venue === "home" ? ts.away : ts.home;
  const won = own?.corners;
  const conceded = opp?.corners;
  if (
    won == null ||
    conceded == null ||
    !Number.isFinite(won) ||
    !Number.isFinite(conceded)
  ) {
    return null;
  }
  return { won, conceded };
}

function collectLiveCorners(
  batches: PredictionBatch[],
  team: string,
  league: string,
  opts?: { beforeDate?: string }
): { n: number; won: number; conceded: number } {
  const key = teamKey(team);
  let n = 0;
  let sWon = 0;
  let sConc = 0;

  for (const batch of batches) {
    for (const match of batch.matches) {
      const matchDate = match.matchDate ?? batch.date;
      if (opts?.beforeDate && matchDate >= opts.beforeDate) continue;
      if (matchLeague(match, batch.league) !== league) continue;
      const venue =
        teamKey(match.homeTeam) === key
          ? "home"
          : teamKey(match.awayTeam) === key
            ? "away"
            : null;
      if (!venue) continue;
      const half = sideCorners(match, venue);
      if (!half) continue;
      n += 1;
      sWon += half.won;
      sConc += half.conceded;
    }
  }

  if (n === 0) return { n: 0, won: 0, conceded: 0 };
  return { n, won: sWon / n, conceded: sConc / n };
}

export function loadClubCornersRates(
  club: string,
  league: string,
  batches: PredictionBatch[],
  opts?: { beforeDate?: string }
): ClubCornersRates {
  const seed = lookupClubCornersRecencyBlend(club, league);
  const live = collectLiveCorners(batches, club, league, opts);

  const seedWon = seed?.avgCornersWon ?? DEFAULT_LEAGUE_BASE;
  const seedConc = seed?.avgCornersConceded ?? DEFAULT_LEAGUE_BASE;
  const seedN = seed?.seedMatches ?? 0;

  const won =
    live.n > 0 ? blendSeedAndLive(seedWon, seedN, live.won, live.n) : seedWon;
  const conceded =
    live.n > 0 ? blendSeedAndLive(seedConc, seedN, live.conceded, live.n) : seedConc;

  const notes: string[] = [];
  if (seed) notes.push(seed.sourceLabel);
  if (live.n > 0) notes.push(`live n=${live.n}`);

  return {
    clubName: standardizeTeamName(club),
    league,
    won,
    conceded,
    nMatches: live.n > 0 ? live.n + seedN : seedN,
    seasonCount: seed?.seasonCount ?? 0,
    seedOnly: live.n === 0,
    sourceNote: notes.length ? notes.join(" · ") : null,
    liveMatches: live.n,
  };
}

function poissonCdfAtOrBelow(k: number, lambda: number): number {
  let sum = 0;
  const max = Math.min(POISSON_GRID_MAX, Math.max(0, Math.floor(k)));
  for (let i = 0; i <= max; i++) sum += poissonPmf(i, Math.max(0, lambda));
  // Tail mass for k >= grid is negligible for typical corner lambdas
  return Math.min(1, Math.max(0, sum));
}

function poissonOverLine(line: number, lambda: number): number {
  // Over n.5 → P(X >= n+1) = 1 - P(X <= n)
  const threshold = Math.floor(line);
  return 1 - poissonCdfAtOrBelow(threshold, lambda);
}

export function matchConfidence(
  home: ClubCornersRates,
  away: ClubCornersRates
): CornersConfidence {
  const homeBlend = lookupClubCornersRecencyBlend(home.clubName, home.league);
  const awayBlend = lookupClubCornersRecencyBlend(away.clubName, away.league);
  const cHome = cornersSeedConfidence(homeBlend, home.liveMatches);
  const cAway = cornersSeedConfidence(awayBlend, away.liveMatches);
  if (cHome === "low" || cAway === "low") return "low";
  if (cHome === "high" && cAway === "high") return "high";
  return "medium";
}

export function predictCornersMatch(params: {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  batches: PredictionBatch[];
  beforeDate?: string;
}): CornersMatchPrediction {
  const home = loadClubCornersRates(params.homeTeam, params.league, params.batches, {
    beforeDate: params.beforeDate,
  });
  const away = loadClubCornersRates(params.awayTeam, params.league, params.batches, {
    beforeDate: params.beforeDate,
  });
  const leagueBase =
    lookupLeagueCornersBaseline(params.league)?.leagueBase ?? DEFAULT_LEAGUE_BASE;
  const base = Math.max(0.5, leagueBase);

  const lambdaHome = Math.max(
    0.2,
    base * (home.won / base) * (away.conceded / base)
  );
  const lambdaAway = Math.max(
    0.2,
    base * (away.won / base) * (home.conceded / base)
  );
  const expectedTotal = lambdaHome + lambdaAway;

  const pOver95 = poissonOverLine(9.5, expectedTotal);
  const pUnder95 = 1 - pOver95;
  const pOver105 = poissonOverLine(10.5, expectedTotal);
  const pUnder105 = 1 - pOver105;
  const pHomeOver45 = poissonOverLine(4.5, lambdaHome);
  const pAwayOver45 = poissonOverLine(4.5, lambdaAway);

  let lean: CornersLean = "lean_none";
  let topProbability = Math.max(pOver95, pUnder95);
  if (pOver95 > pUnder95 + 0.02) {
    lean = "over_9.5";
    topProbability = pOver95;
  } else if (pUnder95 > pOver95 + 0.02) {
    lean = "under_9.5";
    topProbability = pUnder95;
  }

  return {
    matchId: params.matchId,
    homeTeam: params.homeTeam,
    awayTeam: params.awayTeam,
    league: params.league,
    lambdaHome,
    lambdaAway,
    expectedTotal,
    pOver95,
    pUnder95,
    pOver105,
    pUnder105,
    pHomeOver45,
    pAwayOver45,
    lean,
    topProbability,
    confidence: matchConfidence(home, away),
    detail: {
      homeWon: home.won,
      homeConceded: home.conceded,
      awayWon: away.won,
      awayConceded: away.conceded,
      leagueBase: base,
      seedHome: home.sourceNote,
      seedAway: away.sourceNote,
    },
  };
}

export function leanLabel(lean: CornersLean): string {
  if (lean === "over_9.5") return "Over 9.5";
  if (lean === "under_9.5") return "Under 9.5";
  return "No lean";
}

export function listSeedClubRows(
  league?: string | null,
  season?: string | null
): CornersBaselineRow[] {
  let rows = listCornersSeedClubs(league);
  if (season && season !== "all") {
    rows = rows.filter((r) => r.season === season);
  }
  return rows.sort(
    (a, b) => b.avgCornersWon - a.avgCornersWon || a.clubName.localeCompare(b.clubName)
  );
}

export function availableSeedSeasons(): string[] {
  return listCornersSeedSeasons();
}
