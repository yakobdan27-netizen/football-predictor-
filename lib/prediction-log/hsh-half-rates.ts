/**
 * Per-club AF/DA half rates for HSH attack×defence Stage A.
 * Scoring seed (match half totals → /2) + conceded seed, blended with live HT.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { blendSeedAndLive } from "./conceded-half-baselines";
import { lookupClubConcededRecencyBlend } from "./conceded-half-baselines";
import {
  lookupClubScoringRecencyBlend,
  lookupLeagueAfBaselines,
  seasonFromDate,
} from "./half-goals-baselines";
import { matchLeague } from "./match-league";
import type { LogMatch, PredictionBatch } from "./types";

export interface ClubHalfAttackDefence {
  clubName: string;
  league: string;
  af1: number;
  af2: number;
  da1: number;
  da2: number;
  nMatches: number;
  seasonCount: number;
  seedOnly: boolean;
  sourceNote: string | null;
}

export interface LeagueAfBaselines {
  lgAf1: number;
  lgAf2: number;
}

const SHRINK_K = 15;

function teamKey(name: string): string {
  return standardizeTeamName(name).trim().toLowerCase();
}

function sideHalf(
  match: LogMatch,
  venue: "home" | "away"
): { scored1h: number; scored2h: number; conc1h: number; conc2h: number } | null {
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
    scored1h: ownHt,
    scored2h: Math.max(0, ownFt - ownHt),
    conc1h: oppHt,
    conc2h: Math.max(0, oppFt - oppHt),
  };
}

function collectLiveRates(
  batches: PredictionBatch[],
  team: string,
  league: string,
  opts?: { beforeDate?: string }
): { n: number; af1: number; af2: number; da1: number; da2: number } {
  const key = teamKey(team);
  let n = 0;
  let sAf1 = 0;
  let sAf2 = 0;
  let sDa1 = 0;
  let sDa2 = 0;

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
      const half = sideHalf(match, venue);
      if (!half) continue;
      n += 1;
      sAf1 += half.scored1h;
      sAf2 += half.scored2h;
      sDa1 += half.conc1h;
      sDa2 += half.conc2h;
    }
  }

  if (n === 0) return { n: 0, af1: 0, af2: 0, da1: 0, da2: 0 };
  return {
    n,
    af1: sAf1 / n,
    af2: sAf2 / n,
    da1: sDa1 / n,
    da2: sDa2 / n,
  };
}

/** Shrink coefficient toward 1.0 when sample is thin. */
export function shrinkCoeff(
  raw: number,
  nMatches: number,
  seasonCount: number
): number {
  const thin = nMatches < 20 || seasonCount < 3;
  if (!thin) return raw;
  const phi = nMatches / (nMatches + SHRINK_K);
  return phi * raw + (1 - phi) * 1.0;
}

export function loadLeagueAfBaselines(league: string): LeagueAfBaselines {
  const hit = lookupLeagueAfBaselines(league);
  if (hit) return hit;
  return { lgAf1: 0.62, lgAf2: 0.78 };
}

export function loadClubHalfAttackDefence(
  club: string,
  league: string,
  batches: PredictionBatch[],
  opts?: { beforeDate?: string }
): ClubHalfAttackDefence {
  const scoring = lookupClubScoringRecencyBlend(club, league);
  const conceded = lookupClubConcededRecencyBlend(club, league);
  const live = collectLiveRates(batches, club, league, opts);

  const seedAf1 = scoring ? scoring.avg1h / 2 : 0.55;
  const seedAf2 = scoring ? scoring.avg2h / 2 : 0.75;
  const seedDa1 = conceded?.avg1hConceded ?? seedAf1;
  const seedDa2 = conceded?.avg2hConceded ?? seedAf2;
  const seedN = Math.max(
    scoring?.seedMatches ?? 0,
    conceded?.seedMatches ?? 0
  );

  const af1 =
    live.n > 0 ? blendSeedAndLive(seedAf1, seedN, live.af1, live.n) : seedAf1;
  const af2 =
    live.n > 0 ? blendSeedAndLive(seedAf2, seedN, live.af2, live.n) : seedAf2;
  const da1 =
    live.n > 0 ? blendSeedAndLive(seedDa1, seedN, live.da1, live.n) : seedDa1;
  const da2 =
    live.n > 0 ? blendSeedAndLive(seedDa2, seedN, live.da2, live.n) : seedDa2;

  const seasonCount = Math.max(scoring?.seasonCount ?? 0, conceded?.seasonCount ?? 0);
  const nMatches = live.n > 0 ? live.n + seedN : seedN;
  const seedOnly = live.n === 0;

  const notes: string[] = [];
  if (scoring) notes.push(scoring.sourceLabel);
  if (conceded) notes.push(conceded.sourceLabel.replace("seed:", "conceded:"));
  if (live.n > 0) notes.push(`live n=${live.n}`);

  return {
    clubName: standardizeTeamName(club),
    league,
    af1,
    af2,
    da1,
    da2,
    nMatches,
    seasonCount,
    seedOnly,
    sourceNote: notes.length ? notes.join(" · ") : null,
  };
}

export function seasonHintFromBatchDate(date: string | undefined): string | null {
  return seasonFromDate(date);
}
