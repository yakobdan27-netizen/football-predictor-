export type TeamHalfSource = "hist" | "api" | "db" | "prior";

/** Match-level badge: worst of two teams, or live when conditioned. */
export type MatchDataSource = TeamHalfSource | "live";

export type VenueSide = "home" | "away";

export interface TeamHalfProfile {
  team: string;
  venue: VenueSide;
  sc_1h: number;
  sc_2h: number;
  conc_1h: number;
  conc_2h: number;
  n_matches: number;
  last_match_date: string | null;
  source: TeamHalfSource;
  /** Display-only; not used in v1 math. */
  formation?: string | null;
}

export interface TwoHHeavyResult {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  p_2h_gt_1h: number;
  p_2h_eq_1h: number;
  p_2h_lt_1h: number;
  expected_1h: number;
  expected_2h: number;
  confidence: number;
  data_source: MatchDataSource;
  thinData: boolean;
  /** True when either side used KV/API-filled half profile. */
  partlyFromApi: boolean;
  /** True when still below MIN_MATCHES after gap fill (honest insufficient). */
  insufficientData: boolean;
  homeProfile: TeamHalfProfile;
  awayProfile: TeamHalfProfile;
  /** True when probabilities conditioned on realized 1H (in-play 2H). */
  live: boolean;
}

export interface CachedTeamHalfProfile {
  teamId: number;
  teamName: string;
  leagueId: number;
  venue: VenueSide;
  sc_1h: number;
  sc_2h: number;
  conc_1h: number;
  conc_2h: number;
  n_matches: number;
  last_match_date: string | null;
  formation?: string | null;
  updatedAt: string;
  /** Provenance for KV rows — api fills never overwrite manual batch HT. */
  source?: "api" | "hist";
}
