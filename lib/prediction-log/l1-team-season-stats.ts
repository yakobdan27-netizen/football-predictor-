/**
 * Fill Ligue 1 2026/27 team season cards from DB/seed/live only.
 * Exact-season rows required — never invent or copy prior seasons into the card.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { lookupClubConcededBaseline } from "./conceded-half-baselines";
import { lookupClubCornersBaseline } from "./corners-baselines";
import { lookupClubHalfBaseline } from "./half-goals-baselines";
import { matchLeague } from "./match-league";
import {
  L1_LEAGUE_NAME,
  L1_SEASON_2026_27,
  computeDataConfidence,
  emptyL1TeamSeasonCard,
  emptyVenueSplit,
  isL1PromotedTeam,
  l1StyleSeedForTeam,
  type L1TeamSeasonCard,
} from "./l1-season-roster";
import type { PredictionBatch } from "./types";

function exactHalfRow(team: string, season: string) {
  const row = lookupClubHalfBaseline(team, L1_LEAGUE_NAME, season);
  if (!row || row.season !== season) return null;
  return row;
}

function exactCornersRow(team: string, season: string) {
  const row = lookupClubCornersBaseline(team, L1_LEAGUE_NAME, season);
  if (!row || row.season !== season) return null;
  return row;
}

function exactConcededRow(team: string, season: string) {
  const row = lookupClubConcededBaseline(team, L1_LEAGUE_NAME, season);
  if (!row || row.season !== season) return null;
  return row;
}

export function countLiveL1Matches(
  team: string,
  batches: PredictionBatch[],
  season: string
): {
  matches: number;
  goalsFor: number;
  goalsAgainst: number;
  over25: number;
  btts: number;
  scored: number;
} {
  const key = standardizeTeamName(team).toLowerCase();
  let matches = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let over25 = 0;
  let btts = 0;
  let scored = 0;

  for (const batch of batches) {
    for (const match of batch.matches) {
      const league = matchLeague(match, batch.league);
      if (league !== L1_LEAGUE_NAME) continue;
      const date = match.matchDate ?? batch.date;
      if (season === L1_SEASON_2026_27) {
        if (date < "2026-08-01" || date >= "2027-08-01") continue;
      }
      const home = standardizeTeamName(match.homeTeam).toLowerCase();
      const away = standardizeTeamName(match.awayTeam).toLowerCase();
      if (home !== key && away !== key) continue;

      const hg = match.teamStats?.home?.goals;
      const ag = match.teamStats?.away?.goals;
      if (hg == null || ag == null) continue;

      matches++;
      scored++;
      const isHome = home === key;
      const gf = isHome ? hg : ag;
      const ga = isHome ? ag : hg;
      goalsFor += gf;
      goalsAgainst += ga;
      if (hg + ag > 2.5) over25++;
      if (hg > 0 && ag > 0) btts++;
    }
  }

  return { matches, goalsFor, goalsAgainst, over25, btts, scored };
}

export function fillL1TeamSeasonCard(
  team: string,
  opts?: {
    season?: typeof L1_SEASON_2026_27;
    batches?: PredictionBatch[];
    seed_paused?: boolean;
    rosterTeams?: string[];
  }
): L1TeamSeasonCard {
  const season = opts?.season ?? L1_SEASON_2026_27;
  const name = standardizeTeamName(team);
  const is_promoted = isL1PromotedTeam(name, opts?.rosterTeams);
  const base = emptyL1TeamSeasonCard(name, {
    seed_paused: opts?.seed_paused,
    is_promoted,
  });

  const half = exactHalfRow(name, season);
  const corners = exactCornersRow(name, season);
  const conceded = exactConcededRow(name, season);
  const live = countLiveL1Matches(name, opts?.batches ?? [], season);

  let matches_played: number | null = null;
  let goals_scored_pg: number | null = null;
  let goals_conceded_pg: number | null = null;
  let over_2_5_rate: number | null = null;
  let btts_rate: number | null = null;
  let first_half_goal_rate: number | null = null;
  let second_half_goal_rate: number | null = null;
  let corners_won_pg: number | null = null;
  let corners_conceded_pg: number | null = null;
  let conceded_half_goals: number | null = null;

  if (half) {
    matches_played = half.matchesAnalyzed;
    goals_scored_pg = half.avgGoals;
    if (half.avgGoals > 0) {
      first_half_goal_rate = Math.round((half.avg1h / half.avgGoals) * 1000) / 10;
      second_half_goal_rate = Math.round((half.avg2h / half.avgGoals) * 1000) / 10;
    }
  }
  if (corners) {
    matches_played = matches_played ?? corners.matches;
    corners_won_pg = corners.avgCornersWon;
    corners_conceded_pg = corners.avgCornersConceded;
  }
  if (conceded) {
    matches_played = matches_played ?? conceded.matches;
    goals_conceded_pg = conceded.avgConceded;
    conceded_half_goals =
      Math.round(((conceded.avg1hConceded + conceded.avg2hConceded) / 2) * 100) / 100;
  }

  if (live.matches > 0) {
    matches_played = live.matches;
    goals_scored_pg = Math.round((live.goalsFor / live.matches) * 100) / 100;
    goals_conceded_pg = Math.round((live.goalsAgainst / live.matches) * 100) / 100;
    over_2_5_rate = Math.round((live.over25 / live.matches) * 1000) / 10;
    btts_rate = Math.round((live.btts / live.matches) * 1000) / 10;
  }

  const card: L1TeamSeasonCard = {
    ...base,
    team: name,
    season,
    is_promoted,
    matches_played,
    goals_scored_pg,
    goals_conceded_pg,
    over_2_5_rate,
    btts_rate,
    corners_won_pg,
    corners_conceded_pg,
    first_half_goal_rate,
    second_half_goal_rate,
    conceded_half_goals,
    home_split: emptyVenueSplit(),
    away_split: emptyVenueSplit(),
    style_seed: l1StyleSeedForTeam(name),
    data_confidence: computeDataConfidence(matches_played, is_promoted),
    seed_paused: opts?.seed_paused,
  };

  if (live.matches > 0 && opts?.batches?.length) {
    const splits = liveVenueSplits(name, opts.batches, season);
    card.home_split = splits.home;
    card.away_split = splits.away;
  }

  return card;
}

function liveVenueSplits(
  team: string,
  batches: PredictionBatch[],
  season: string
): { home: ReturnType<typeof emptyVenueSplit>; away: ReturnType<typeof emptyVenueSplit> } {
  const key = standardizeTeamName(team).toLowerCase();
  let hN = 0,
    hGf = 0,
    hGa = 0,
    aN = 0,
    aGf = 0,
    aGa = 0;

  for (const batch of batches) {
    for (const match of batch.matches) {
      if (matchLeague(match, batch.league) !== L1_LEAGUE_NAME) continue;
      const date = match.matchDate ?? batch.date;
      if (season === L1_SEASON_2026_27) {
        if (date < "2026-08-01" || date >= "2027-08-01") continue;
      }
      const hg = match.teamStats?.home?.goals;
      const ag = match.teamStats?.away?.goals;
      if (hg == null || ag == null) continue;
      const home = standardizeTeamName(match.homeTeam).toLowerCase();
      const away = standardizeTeamName(match.awayTeam).toLowerCase();
      if (home === key) {
        hN++;
        hGf += hg;
        hGa += ag;
      } else if (away === key) {
        aN++;
        aGf += ag;
        aGa += hg;
      }
    }
  }

  return {
    home: {
      goals_pg: hN > 0 ? Math.round((hGf / hN) * 100) / 100 : null,
      conceded_pg: hN > 0 ? Math.round((hGa / hN) * 100) / 100 : null,
    },
    away: {
      goals_pg: aN > 0 ? Math.round((aGf / aN) * 100) / 100 : null,
      conceded_pg: aN > 0 ? Math.round((aGa / aN) * 100) / 100 : null,
    },
  };
}

export function buildAllL1SeasonCards(
  batches?: PredictionBatch[],
  pausedTeams?: Set<string>,
  teamList?: string[]
): Record<string, L1TeamSeasonCard> {
  const list = teamList ?? [];
  const cards: Record<string, L1TeamSeasonCard> = {};
  for (const team of list) {
    cards[team] = fillL1TeamSeasonCard(team, {
      batches,
      seed_paused: pausedTeams?.has(team),
      rosterTeams: list,
    });
  }
  return cards;
}
