/**
 * Seed-backed expected goals for correct score when club records are thin/flat.
 * Uses scoring + conceded half-goals priors (2021/22–2025/26), not SQLite.
 */
import {
  lookupClubScoringRecencyBlend,
  lookupLeagueHalfBaseline,
} from "./half-goals-baselines";
import { lookupClubConcededRecencyBlend } from "./conceded-half-baselines";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";
import type { ClubStatMetadata } from "./club-record-types";

const HOME_SCORE_FACTOR = 1.1;
const AWAY_SCORE_FACTOR = 0.9;
const HOME_CONCEDE_FACTOR = 0.95;
const AWAY_CONCEDE_FACTOR = 1.05;

export function isFlatStatMetadata(meta: ClubStatMetadata | null | undefined): boolean {
  if (!meta) return true;
  const vals = [
    meta.attack_strength_home,
    meta.attack_strength_away,
    meta.defense_strength_home,
    meta.defense_strength_away,
  ];
  return vals.every((v) => Math.abs(v - 1) < 0.05);
}

/** Per-team goals scored estimate from match-total scoring seed + conceded prior. */
export function estimateClubGoalsScored(club: string, league: string): number | null {
  const scoring = lookupClubScoringRecencyBlend(club, league);
  const conceded = lookupClubConcededRecencyBlend(club, league);
  const lg = lookupLeagueHalfBaseline(league);
  const lgGoals = lg?.avgGoals ?? 2.7;

  if (scoring && conceded) {
    return Math.max(0.2, scoring.avgGoals - conceded.avgConceded);
  }
  if (scoring) return Math.max(0.2, scoring.avgGoals / 2);
  if (conceded) return Math.max(0.2, lgGoals - conceded.avgConceded);
  return null;
}

export function estimateClubGoalsConceded(club: string, league: string): number | null {
  const conceded = lookupClubConcededRecencyBlend(club, league);
  if (conceded) return Math.max(0.15, conceded.avgConceded);
  const scored = estimateClubGoalsScored(club, league);
  const lg = lookupLeagueHalfBaseline(league);
  const lgGoals = lg?.avgGoals ?? 2.7;
  if (scored != null) return Math.max(0.15, lgGoals - scored);
  return null;
}

/**
 * Classic interaction λs from seed priors:
 * λ_home ≈ home_scored_rate × (away_conceded / league_home)
 * λ_away ≈ away_scored_rate × (home_conceded / league_away)
 */
export function seedCorrectScoreLambdas(
  homeClub: string,
  awayClub: string,
  league: string
): { lambdaHome: number; lambdaAway: number; source: string } | null {
  const homeScored = estimateClubGoalsScored(homeClub, league);
  const awayScored = estimateClubGoalsScored(awayClub, league);
  const homeConc = estimateClubGoalsConceded(homeClub, league);
  const awayConc = estimateClubGoalsConceded(awayClub, league);
  if (homeScored == null || awayScored == null || homeConc == null || awayConc == null) {
    return null;
  }

  const lg = lookupLeagueHalfBaseline(league);
  const lgGoals = lg?.avgGoals ?? STAT_ENGINE_CONFIG.DEFAULT_LEAGUE_HOME_GOALS + STAT_ENGINE_CONFIG.DEFAULT_LEAGUE_AWAY_GOALS;
  const lgHome = Math.max(0.5, lgGoals * 0.55);
  const lgAway = Math.max(0.4, lgGoals * 0.45);

  const homeFor = homeScored * HOME_SCORE_FACTOR;
  const awayFor = awayScored * AWAY_SCORE_FACTOR;
  const homeAgainst = homeConc * HOME_CONCEDE_FACTOR;
  const awayAgainst = awayConc * AWAY_CONCEDE_FACTOR;

  const lambdaHome = Math.max(0.15, homeFor * (awayAgainst / lgHome));
  const lambdaAway = Math.max(0.15, awayFor * (homeAgainst / lgAway));

  return {
    lambdaHome,
    lambdaAway,
    source: "seed:scoring+conceded (2021/22–2025/26)",
  };
}
