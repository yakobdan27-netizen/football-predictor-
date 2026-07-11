export const CLUB_RECORD_SCHEMA_VERSION = 1;

export type HistoryTypeKey =
  | "winLose"
  | "shotsOnTarget"
  | "totalShots"
  | "goalsScored"
  | "goalsConceded"
  | "cleanSheet"
  | "yellowCards"
  | "redCards"
  | "corners"
  | "offsides"
  | "fouls"
  | "possession"
  | "bothTeamsScore"
  | "overUnder";

export const HISTORY_TYPE_KEYS: HistoryTypeKey[] = [
  "winLose",
  "shotsOnTarget",
  "totalShots",
  "goalsScored",
  "goalsConceded",
  "cleanSheet",
  "yellowCards",
  "redCards",
  "corners",
  "offsides",
  "fouls",
  "possession",
  "bothTeamsScore",
  "overUnder",
];

export type HistoryResult = "hit" | "miss" | "pending";

export interface HistoryEntry {
  id: string;
  date: string;
  batchId: string;
  matchId: string;
  opponentId: string;
  opponentName: string;
  venue: "home" | "away";
  predicted: number | string;
  actual?: number | string;
  result: HistoryResult;
  odds?: number;
  /** Learning sample weight; defaults to 1. Abnormal matches use 0.25. */
  sampleWeight?: number;
  superseded?: boolean;
  editedAt?: string;
}

export type ClubHistories = Record<HistoryTypeKey, HistoryEntry[]>;

export interface ClubCapacity {
  winRate: number;
  homeWinRate: number;
  awayWinRate: number;
  avgShotsOnTarget: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  cleanSheetRate: number;
  avgYellowCards: number;
  avgRedCards: number;
  avgCorners: number;
  avgOffsides: number;
  avgFouls: number;
  avgPossession: number;
  recentForm: number;
  predictionAccuracyByType: Partial<Record<HistoryTypeKey, number>>;
  sampleSize: number;
  lowSample: boolean;
}

export interface GammaPosterior {
  type: "gamma";
  prior: { shape: number; rate: number };
  posterior: { shape: number; rate: number };
  n: number;
  lastUpdated: string;
}

export interface BetaPosterior {
  type: "beta";
  prior: { alpha: number; beta: number };
  posterior: { alpha: number; beta: number };
  n: number;
  lastUpdated: string;
}

export type BayesianMarketKey =
  | "goals_scored_home"
  | "goals_scored_away"
  | "goals_conceded_home"
  | "goals_conceded_away"
  | "shots_on_target"
  | "total_shots"
  | "corners"
  | "yellow_cards"
  | "red_cards"
  | "fouls"
  | "win_rate"
  | "btts_rate"
  | "clean_sheet_rate";

export interface ClubBayesianMarkets {
  markets: Partial<Record<BayesianMarketKey, GammaPosterior | BetaPosterior>>;
  version: 1;
}

export interface ClubStatMetadata {
  attack_strength_home: number;
  attack_strength_away: number;
  defense_strength_home: number;
  defense_strength_away: number;
  goals_for_rolling: number;
  goals_against_rolling: number;
  xg_for: number;
  xg_against: number;
  form_points: number;
  tier: "A" | "B" | "C" | "D" | null;
  sample_size: number;
  lastUpdated: string;
}

export interface ClubLineupSnapshot {
  date: string;
  formation?: string;
  starting: string[];
  opponentId: string;
}

export interface ClubRecord {
  clubId: string;
  clubName: string;
  league: string;
  leagueId?: string;
  createdAt: string;
  lastUpdated: string;
  histories: ClubHistories;
  capacity: ClubCapacity;
  statMetadata?: ClubStatMetadata;
  bayesianMarkets?: ClubBayesianMarkets;
  /** Last few scraped starting XIs (capped); optional supportive context only. */
  recentLineups?: ClubLineupSnapshot[];
}

export interface ClubIndexEntry {
  clubId: string;
  clubName: string;
  league: string;
  leagueId?: string;
  normalizedName: string;
}

export interface ClubIndex {
  schemaVersion: number;
  updatedAt: string;
  clubs: ClubIndexEntry[];
}

export interface BatchIndex {
  schemaVersion: number;
  updatedAt: string;
  batchIds: string[];
}

export interface MatchupCache {
  clubIdA: string;
  clubIdB: string;
  clubNameA: string;
  clubNameB: string;
  meetings: number;
  homeWinsA: number;
  awayWinsA: number;
  draws: number;
  lastMeeting?: string;
  updatedAt: string;
}

export function emptyHistories(): ClubHistories {
  return Object.fromEntries(
    HISTORY_TYPE_KEYS.map((k) => [k, [] as HistoryEntry[]])
  ) as ClubHistories;
}

export function emptyCapacity(): ClubCapacity {
  return {
    winRate: 0,
    homeWinRate: 0,
    awayWinRate: 0,
    avgShotsOnTarget: 0,
    avgGoalsScored: 0,
    avgGoalsConceded: 0,
    cleanSheetRate: 0,
    avgYellowCards: 0,
    avgRedCards: 0,
    avgCorners: 0,
    avgOffsides: 0,
    avgFouls: 0,
    avgPossession: 0,
    recentForm: 5,
    predictionAccuracyByType: {},
    sampleSize: 0,
    lowSample: true,
  };
}

export function createClubRecord(
  clubId: string,
  clubName: string,
  league: string
): ClubRecord {
  const now = new Date().toISOString();
  return {
    clubId,
    clubName,
    league,
    createdAt: now,
    lastUpdated: now,
    histories: emptyHistories(),
    capacity: emptyCapacity(),
  };
}
