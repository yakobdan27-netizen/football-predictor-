/**
 * Shots on target O/U — team won/conceded interaction + Poisson O/U.
 * Mirrors corners-model pattern; advisory only.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import {
  LEAGUE_PRIOR_FULL_SAMPLE,
  shrinkTowardLeaguePrior,
} from "./league-priors";
import { matchLeague } from "./match-league";
import { poissonOverLine } from "./poisson-ou";
import type { LogMatch, PredictionBatch } from "./types";

export const MATCH_SOT_LINES = [3.5, 4.5, 5.5] as const;
export const TEAM_SOT_LINES = [1.5, 2.5, 3.5] as const;

export type SotConfidence = "high" | "medium" | "low";

export interface ClubSotRates {
  clubName: string;
  league: string;
  forAvg: number;
  againstAvg: number;
  nMatches: number;
  liveMatches: number;
}

export interface SotMarkets {
  status: "ok" | "insufficient";
  lambdaHome: number;
  lambdaAway: number;
  nMatches: number;
  confidence: SotConfidence;
  lines: {
    match: Record<number, { over: number; under: number }>;
    home: Record<number, { over: number; under: number }>;
    away: Record<number, { over: number; under: number }>;
  };
}

const DEFAULT_SIDE_SOT = 2.2;

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

function sideSot(
  match: LogMatch,
  venue: "home" | "away"
): { forVal: number; againstVal: number } | null {
  const ts = match.teamStats;
  if (!ts) return null;
  const own = venue === "home" ? ts.home : ts.away;
  const opp = venue === "home" ? ts.away : ts.home;
  const forVal = own?.shotsOnTarget;
  const againstVal = opp?.shotsOnTarget;
  if (
    forVal == null ||
    againstVal == null ||
    !Number.isFinite(forVal) ||
    !Number.isFinite(againstVal)
  ) {
    return null;
  }
  return { forVal, againstVal };
}

function collectLiveSot(
  batches: PredictionBatch[],
  team: string,
  league: string,
  opts?: { beforeDate?: string }
): { n: number; forAvg: number; againstAvg: number } {
  const key = teamKey(team);
  let n = 0;
  let sFor = 0;
  let sAgainst = 0;

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
      const half = sideSot(match, venue);
      if (!half) continue;
      n += 1;
      sFor += half.forVal;
      sAgainst += half.againstVal;
    }
  }

  if (n === 0) return { n: 0, forAvg: DEFAULT_SIDE_SOT, againstAvg: DEFAULT_SIDE_SOT };
  return { n, forAvg: sFor / n, againstAvg: sAgainst / n };
}

export function loadClubSotRates(
  club: string,
  league: string,
  batches: PredictionBatch[],
  opts?: { beforeDate?: string }
): ClubSotRates {
  const live = collectLiveSot(batches, club, league, opts);
  return {
    clubName: standardizeTeamName(club),
    league,
    forAvg: live.forAvg,
    againstAvg: live.againstAvg,
    nMatches: live.n,
    liveMatches: live.n,
  };
}

function matchConfidence(home: ClubSotRates, away: ClubSotRates): SotConfidence {
  const n = Math.min(home.nMatches, away.nMatches);
  if (n >= 8) return "high";
  if (n >= 3) return "medium";
  return "low";
}

function buildLineMap(
  lambda: number,
  lines: readonly number[]
): Record<number, { over: number; under: number }> {
  const out: Record<number, { over: number; under: number }> = {};
  for (const line of lines) {
    const over = poissonOverLine(line, lambda);
    out[line] = { over, under: 1 - over };
  }
  return out;
}

export function predictSotMarkets(params: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  batches: PredictionBatch[];
  beforeDate?: string;
}): SotMarkets {
  const home = loadClubSotRates(params.homeTeam, params.league, params.batches, {
    beforeDate: params.beforeDate,
  });
  const away = loadClubSotRates(params.awayTeam, params.league, params.batches, {
    beforeDate: params.beforeDate,
  });

  const sidePrior = Math.max(0.5, DEFAULT_SIDE_SOT);
  const base = sidePrior;

  let lambdaHome = Math.max(
    0.3,
    base * (home.forAvg / base) * (away.againstAvg / base)
  );
  let lambdaAway = Math.max(
    0.3,
    base * (away.forAvg / base) * (home.againstAvg / base)
  );

  const thinSample = Math.min(home.nMatches, away.nMatches);
  if (thinSample < LEAGUE_PRIOR_FULL_SAMPLE) {
    lambdaHome = Math.max(
      0.3,
      shrinkTowardLeaguePrior(lambdaHome, sidePrior, thinSample)
    );
    lambdaAway = Math.max(
      0.3,
      shrinkTowardLeaguePrior(lambdaAway, sidePrior, thinSample)
    );
  }

  const nMatches = home.nMatches + away.nMatches;
  if (nMatches < 2 && home.liveMatches === 0 && away.liveMatches === 0) {
    return {
      status: "insufficient",
      lambdaHome,
      lambdaAway,
      nMatches,
      confidence: "low",
      lines: { match: {}, home: {}, away: {} },
    };
  }

  const expectedTotal = lambdaHome + lambdaAway;
  const confidence = matchConfidence(home, away);

  return {
    status: "ok",
    lambdaHome,
    lambdaAway,
    nMatches,
    confidence,
    lines: {
      match: buildLineMap(expectedTotal, MATCH_SOT_LINES),
      home: buildLineMap(lambdaHome, TEAM_SOT_LINES),
      away: buildLineMap(lambdaAway, TEAM_SOT_LINES),
    },
  };
}
