export type LogMarketKey =
  | "1x2"
  | "double_chance"
  | "btts"
  | "home_goals_ou"
  | "away_goals_ou"
  | "ht_1x2"
  | "more_goals_half"
  | "draw_one_half"
  | "win_one_half"
  | "shots_ou"
  | "home_shots_ou"
  | "away_shots_ou"
  | "sot_ou"
  | "corners_ou"
  | "throw_ins_ou"
  | "offsides_ou";

export interface MarketPrediction {
  prediction: string;
  line?: number;
  confidence: number;
  odds?: number;
}

export interface MarketActual {
  actual: string | number;
}

export type ScoreResult = "correct" | "wrong" | "push" | "void" | null;

export interface GradedMarketDetail {
  result: ScoreResult;
  actual?: string | number;
  reason: string;
}

export type MarketMode = "single" | "combined";

export interface ComboLegPick {
  comboId: string;
  odds: number;
  systemProbability?: number;
  valueEdge?: number;
}

export interface CorrectScorePick {
  home: number;
  away: number;
  odds?: number;
  systemProbability?: number;
  valueEdge?: number;
}

export interface CorrectScoreSnapshot {
  top6: Array<{ home: number; away: number; probPct: number }>;
  concentrationIndex: number;
  mostLikely: { home: number; away: number; probPct: number };
}

export interface CorrectScoreCalibration {
  rank: "top1" | "top3" | "top6" | "outside";
  actualHome: number;
  actualAway: number;
}

export interface CorrectScoreStats {
  overall: { top1Hits: number; top3Hits: number; top6Hits: number; sample: number };
  byLeague: Record<string, { top3Hits: number; sample: number }>;
  rollingTop3Rate: number | null;
}

export interface TeamSideStats {
  /** Full-time goals scored by this side. */
  goals?: number;
  /** Half-time goals scored by this side. */
  firstHalfGoals?: number;
  yellowCards?: number;
  redCards?: number;
  fouls?: number;
  possession?: number;
  totalShots?: number;
  shotsOnTarget?: number;
  corners?: number;
  throwIns?: number;
  offsides?: number;
}

export interface GoalTimingCurve {
  g0_15: number;
  g16_30: number;
  g31_45: number;
  g46_60: number;
  g61_75: number;
  g76_90plus: number;
}

export interface MatchGoalTiming {
  goalInFirst10?: boolean;
  goalInLast10?: boolean;
  timingBuckets?: GoalTimingCurve;
  secondHalfCards?: boolean;
}

export interface MatchSideLineup {
  starting: string[];
  substitutes: string[];
  /** e.g. "4-3-3" when Livescore provides Fo. */
  formation?: string;
}

export interface MatchLineups {
  home: MatchSideLineup;
  away: MatchSideLineup;
}

export type MatchResultSource = "manual" | "livescore" | "api-football" | "livescore-bulk";

export interface MatchTeamStats {
  home: TeamSideStats;
  away: TeamSideStats;
  firstHalfResult?: "home" | "draw" | "away";
  goalTiming?: MatchGoalTiming;
  /** @deprecated Prefer penaltiesAwarded */
  penaltyAwarded?: boolean;
  firstGoalSide?: "home" | "away" | "none";
  penaltiesAwarded?: { home?: number; away?: number };
  /** When true, learning writers apply a reduced sample weight. */
  abnormalMatch?: boolean;
  /** Starting XI + substitutes when scraped or entered. */
  lineups?: MatchLineups;
}

export interface LogMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeClubId?: string;
  awayClubId?: string;
  predictions: Partial<Record<LogMarketKey, MarketPrediction>>;
  actualResults: Partial<Record<LogMarketKey, MarketActual>>;
  scored: Partial<Record<LogMarketKey, ScoreResult>>;
  recommendedScored?: Partial<Record<LogMarketKey, ScoreResult>>;
  teamStats?: MatchTeamStats;
  marketMode?: MarketMode;
  comboPick?: ComboLegPick;
  correctScorePick?: CorrectScorePick;
  correctScoreSnapshot?: CorrectScoreSnapshot;
  correctScoreCalibration?: CorrectScoreCalibration;
  /** Outcome-only silent grades for markets without a pick (result usually null). */
  silentGrades?: Partial<Record<LogMarketKey, GradedMarketDetail>>;
  /** Grade for the selected single market or combo leg. */
  primaryGrade?: GradedMarketDetail;
  /** Grade of frozen better-alternative when present and gradable. */
  altGrade?: GradedMarketDetail & { marketLabel: string; predictionLabel: string };
  /** How FT/stats were last filled (manual remains fallback). */
  resultSource?: MatchResultSource;
  /** Canonical Livescore match URL when known. */
  livescoreUrl?: string;
  /** Livescore event id (Eid). */
  livescoreEventId?: string;
}

export type RecommendationTier = "safe" | "balanced" | "aggressive";

export type RecommendationStatus = "PENDING" | "SETTLED";

export interface RecommendedPickMathSnapshot {
  signals: {
    capacityEdge: number;
    recentForm: number;
    headToHead: number;
    yourAccuracy: number;
    luckyNudge: number;
    /** Optional supportive lineup/formation context (0–100). */
    lineupContext?: number;
  };
  reliability: {
    capacityEdge: number;
    recentForm: number;
    headToHead: number;
    yourAccuracy: number;
    luckyNudge: number;
    lineupContext?: number;
  };
  pSignal: number;
  oddsUsed: number | null;
  concentrationIndex?: number;
  leagueAdjust?: LeagueAdjustAudit;
  statLayer?: {
    pCustom: number;
    pStat: number;
    pDc: number;
    pMl: number;
    scoreGrid?: number[][];
    lambdaHome?: number;
    lambdaAway?: number;
    mlProbs?: { home: number; draw: number; away: number };
    calibrated: boolean;
    bayesianLayer?: {
      pMarket: number;
      pLo: number;
      pHi: number;
      intervalWidth: number;
      confidence: number;
      lambdaHome: number;
      lambdaAway: number;
    };
  };
}

export interface FrozenMarketEntry {
  marketKey: LogMarketKey;
  marketLabel: string;
  predictionLabel: string;
  pFinal: number;
  selected: boolean;
  /** Raw pick value for post-result grading (optional on older snapshots). */
  prediction?: string;
  line?: number;
}

export interface FrozenSystemPick {
  outcome: "home" | "draw" | "away";
  label: string;
}

export interface FrozenWorkflowStep {
  phase: string;
  message: string;
  matchId?: string;
}

export interface FrozenBetterAlternative {
  marketKey: LogMarketKey;
  marketLabel: string;
  predictionLabel: string;
  pFinal: number;
  deltaPct: number;
  isOptimal: boolean;
  /** Raw pick value for post-result grading (optional on older snapshots). */
  prediction?: string;
  line?: number;
}

export interface RecommendedBatchMathSnapshot {
  totalCombinedOdds: number | null;
  batchRiskScore: number;
  batchRiskBand: "safe" | "caution" | "high";
  rOdds: number;
  rLoss: number;
  rBatch: number;
  averagePFinal: number | null;
  lambda: number;
  pFinalByMatch: Record<string, number>;
  pFinalBaseByMatch?: Record<string, number>;
  tierBoostByMatch?: Record<string, number>;
  tierInfoByMatch?: Record<
    string,
    {
      homeTier: string | null;
      awayTier: string | null;
      tierGap: number;
      tierBoostPct: number;
      direction: -1 | 0 | 1;
      appliedBoost: number;
      higherTierTeam: string | null;
      pFinalBase: number;
      pFinalWithTier: number;
    }
  >;
  marketComparisonByMatch?: Record<string, FrozenMarketEntry[]>;
  systemPickByMatch?: Record<string, FrozenSystemPick>;
  betterAlternativeByMatch?: Record<string, FrozenBetterAlternative>;
  /** Good / Risky / Avoid vs selected market (frozen at generation). */
  pickCommentByMatch?: Record<
    string,
    { label: "good" | "risky" | "avoid"; message: string }
  >;
  workflowLog?: FrozenWorkflowStep[];
  reductionSteps?: import("./dynamic-batch-risk").ReductionStep[];
  settingsSnapshot: {
    oddsFilteringEnabled: boolean;
    tier1MinPFinal: number;
    tier3MaxBatchRisk: number;
    tier3AllowAlternativeMarkets: boolean;
    learnerEnabled: boolean;
    luckyNumbers: number[];
    betterAlternativeThresholdPct?: number;
  };
}

export type RecommendationAction = "keep" | "revise" | "remove" | "add_alternative";

export type LearnerPickLabel = "learner_suggestion" | "risk_removed" | "kept_by_learner";

export interface RecommendedPick extends MarketPrediction {
  action: RecommendationAction;
  judgment: string;
  accepted: boolean;
  original?: MarketPrediction;
  /** Short explanation of how system confidence was derived. */
  confidenceBreakdown?: string;
  /** AI Learner label when learner recommendations are enabled. */
  learnerLabel?: LearnerPickLabel;
  /** Traceable reason from stored historical data. */
  learnerWhy?: string;
  /** Personal historical confidence for similar picks (0–100). */
  learnerConfidence?: number;
  /** Master probability before batch risk brakes (0–100). */
  pSignal?: number;
  /** Master probability after batch risk brakes (0–100). */
  pFinal?: number;
  /** Confidence band derived from pFinal. */
  confidenceBand?: "strong" | "solid" | "coin_flip" | "avoid";
  /** Total data points backing this probability. */
  dataSampleSize?: number;
  /** Frozen signal math captured at generation time. */
  mathSnapshot?: RecommendedPickMathSnapshot;
}

export interface RecommendedMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  predictions: Partial<Record<LogMarketKey, RecommendedPick>>;
}

export type MatchJudgmentLabel = "strong_keep" | "keep_caution" | "skip";

export interface EvidencePoint {
  label: string;
  value: string;
  pct: number | null;
  sample: number;
}

export interface MatchGameListEntry {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  similarityScore: number;
  combinedScore: number;
  judgment: MatchJudgmentLabel;
  judgmentText: string;
  selected: boolean;
  legOdds: number | null;
  evidence: EvidencePoint[];
  skipReason?: string;
}

export interface RecommendedBatch {
  displayName: string;
  generatedAt: string;
  engineVersion: number;
  tier?: RecommendationTier;
  matches: RecommendedMatch[];
  acceptAll: boolean;
  summary: RecommendedBatchSummary;
  gameList: MatchGameListEntry[];
  /** True when generated by the AI Learner overlay. */
  learnerGenerated?: boolean;
  /** Snapshot of learner advice at generation time. */
  learnerAdvice?: LearnerAdvice;
  /** Immutable batch-level math captured at generation time. */
  mathSnapshot?: RecommendedBatchMathSnapshot;
  /** User-entered bookmaker odds per match for combined selections. */
  comboOddsByMatch?: Record<string, number>;
  /** Scored combo outcomes after results entry. */
  comboScoredByMatch?: Record<string, ScoreResult>;
  /** Combo id selected per match at settlement time. */
  comboPickByMatch?: Record<string, string>;
  comboAccumulatorWon?: boolean | null;
  /** Did frozen better-alts beat wrong selected picks? */
  alternativeSuggestionStats?: {
    evaluated: number;
    altWouldHaveWon: number;
  };
}

export type RiskLevel = "low" | "medium" | "high";

export interface RecommendedBatchSummary {
  totalCombinedOdds: number | null;
  riskLevel: RiskLevel;
  matchesIncluded: number;
  matchesDropped: number;
  averagePFinal?: number | null;
  summaryJudgment: string;
  clubInsight?: string;
  exclusions: Array<{
    matchId: string;
    homeTeam: string;
    awayTeam: string;
    reason: string;
  }>;
}

export interface RecommendationSettings {
  oddsFilteringEnabled: boolean;
  tier1MinPFinal: number;
  tier3MaxBatchRisk: number;
  tier3AllowAlternativeMarkets: boolean;
  betterAlternativeThresholdPct: number;
}

export type ComboCategory =
  | "result_goals"
  | "dc_goals"
  | "btts_goals"
  | "goal_band"
  | "half"
  | "team_total";

export interface ComboMarketDef {
  id: string;
  label: string;
  enabled: boolean;
  requiresHalfTime?: boolean;
  category: ComboCategory;
}

export interface CombinedOddsSettings {
  markets: ComboMarketDef[];
  tierMinPFinal: { safe: number; balanced: number; aggressive: number };
  betterAlternativeThresholdPct: number;
  comboShrinkMinSample: number;
  showSingleMarkets: boolean;
  showCombinedMarkets: boolean;
  highlightPositiveValue: boolean;
  warnNegativeValue: boolean;
  defaultMarketMode: MarketMode;
}

export interface ComboTypeLearnerStat {
  wins: number;
  losses: number;
  winRate: number | null;
}

export type LeagueConfidenceLevel = "low" | "medium" | "high";

export interface LeagueCharacterTrait {
  value: number | null;
  baselineDelta: number | null;
  sampleSize: number;
  manual?: boolean;
}

export interface LeagueGoalTimingProfile extends GoalTimingCurve {
  sampleSize: number;
}

export interface LeagueCharacterProfile {
  early_goal_rate_0_10: LeagueCharacterTrait;
  first_half_goals_avg: LeagueCharacterTrait;
  second_half_goals_avg: LeagueCharacterTrait;
  half_dominance: LeagueCharacterTrait;
  late_goal_rate_80_90: LeagueCharacterTrait;
  goal_timing_curve: LeagueGoalTimingProfile;
  goals_per_match_avg: LeagueCharacterTrait;
  over_2_5_rate: LeagueCharacterTrait;
  btts_rate: LeagueCharacterTrait;
  clean_sheet_rate: LeagueCharacterTrait;
  draw_rate: LeagueCharacterTrait;
  home_win_rate: LeagueCharacterTrait;
  offsides_per_match_avg: LeagueCharacterTrait;
  shots_per_match_avg: LeagueCharacterTrait;
  shots_on_target_avg: LeagueCharacterTrait;
  shot_conversion_rate: LeagueCharacterTrait;
  corners_per_match_avg: LeagueCharacterTrait;
  fouls_per_match_avg: LeagueCharacterTrait;
  yellow_cards_per_match_avg: LeagueCharacterTrait;
  red_card_rate: LeagueCharacterTrait;
  penalty_rate: LeagueCharacterTrait;
  comeback_rate: LeagueCharacterTrait;
  favourite_reliability: LeagueCharacterTrait;
  home_advantage_index: LeagueCharacterTrait;
  scoreline_predictability: LeagueCharacterTrait;
  tempo_index: LeagueCharacterTrait;
  first_goal_wins_rate: LeagueCharacterTrait;
  second_half_card_bias: LeagueCharacterTrait;
  late_drama_index: LeagueCharacterTrait;
}

export interface League {
  leagueId: string;
  leagueName: string;
  country?: string;
  season: string;
  matchesLogged: number;
  characterProfile: LeagueCharacterProfile;
  confidenceLevel: LeagueConfidenceLevel;
  lastUpdated: string;
}

export interface LeagueProfilesStore {
  schemaVersion: number;
  updatedAt: string;
  leagues: Record<string, League>;
  manualFields: Record<string, string[]>;
}

export const LEAGUE_PROFILE_SCHEMA_VERSION = 1;

export interface LeagueAdjustAudit {
  trait: string;
  delta: number;
  appliedPct: number;
}

export interface BulkScrapeMeta {
  season: "2025/2026";
  source: "livescore-bulk";
  scrapedAt: string;
}

export interface PredictionBatch {
  id: string;
  date: string;
  league: string;
  leagueId?: string;
  batchName: string;
  createdAt: string;
  batchKind?: "manual" | "recommended";
  sourceBatchId?: string;
  recommendationTier?: RecommendationTier;
  recommendationStatus?: RecommendationStatus;
  recommendationId?: string;
  settledAt?: string;
  settlementSummary?: string;
  matches: LogMatch[];
  recommended?: RecommendedBatch;
  /** Present on Livescore bulk last-5 history batches. */
  bulkScrapeMeta?: BulkScrapeMeta;
}

export type OddsBandId = "1.00-1.50" | "1.51-2.00" | "2.01-2.50" | "2.51-3.00";

export interface OddsBandStats {
  band: OddsBandId;
  total: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number | null;
  avgWinOdds: number | null;
  avgLossOdds: number | null;
  valueScore: number | null;
  lowSample: boolean;
}

export interface OddsAnalysisHistory {
  bands: Record<OddsBandId, OddsBandStats>;
  recentBands: Record<OddsBandId, OddsBandStats>;
  mostWonBand: OddsBandId | null;
  mostLostBand: OddsBandId | null;
  bestValueBand: OddsBandId | null;
}

export interface MarketAccuracyStats {
  correct: number;
  wrong: number;
  push: number;
  pct: number | null;
}

export interface ScoredRow {
  batchId: string;
  batchName: string;
  league: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  market: LogMarketKey;
  prediction: string;
  line?: number;
  confidence: number;
  odds?: number;
  actual: string | number;
  result: ScoreResult;
}

export interface MarketRank {
  market: LogMarketKey;
  label: string;
  pct: number;
  total: number;
}

export interface AnalysisHistory {
  schemaVersion: number;
  updatedAt: string;
  totalScored: number;
  marketAccuracy: Partial<Record<LogMarketKey, MarketAccuracyStats>>;
  leagueAccuracy: Record<string, Partial<Record<LogMarketKey, MarketAccuracyStats>>>;
  highConfidenceAccuracy: MarketAccuracyStats;
  recentForm: MarketAccuracyStats;
  topMarkets: MarketRank[];
  weakestMarkets: MarketRank[];
  calibrationNote: string;
  oddsAnalysis: OddsAnalysisHistory;
}

export const SCHEMA_VERSION = 4;

export interface HitStats {
  correct: number;
  wrong: number;
  push: number;
  pct: number | null;
  sample: number;
}

export type ClubOddsRangeId = "1.50-2.00" | "2.01-2.50" | "2.51-3.00";

export interface ClubOddsRangeStats {
  range: ClubOddsRangeId;
  correct: number;
  wrong: number;
  pct: number | null;
  sample: number;
}

export interface ClubStreakStats {
  currentOverStreak: number;
  currentUnderStreak: number;
  currentWinStreak: number;
  maxOverStreak: number;
  maxUnderStreak: number;
}

export interface ClubProfileMetrics {
  result1x2: HitStats;
  doubleChance: HitStats;
  btts: HitStats;
  bttsByOddsRange: ClubOddsRangeStats[];
  overUnderGoals: HitStats;
  firstHalfSecondHalf: HitStats;
  numericLines: {
    shots: HitStats;
    sot: HitStats;
    corners: HitStats;
  };
  homeRecord: HitStats;
  awayRecord: HitStats;
  highRisk: HitStats;
  streaks: ClubStreakStats;
}

export interface ClubRecentMatch {
  batchId: string;
  date: string;
  opponent: string;
  venue: "home" | "away";
  hitRatePct: number | null;
  picksScored: number;
}

export interface ClubProfile {
  id: string;
  clubName: string;
  league: string;
  lastUpdated: string;
  version: number;
  totalMatches: number;
  metrics: ClubProfileMetrics;
  recentMetrics: ClubProfileMetrics;
  weightedMetrics: ClubProfileMetrics;
  strengths: string[];
  weaknesses: string[];
  tags: string[];
  summary: string;
  recentMatches: ClubRecentMatch[];
}

export interface ClubProfilesStore {
  schemaVersion: number;
  updatedAt: string;
  profiles: Record<string, ClubProfile>;
}

/** Structured team traits learned from user-entered results (local only). */
export const TEAM_CHARACTERISTICS_SCHEMA_VERSION = 1;

export type AttackingStyle = "direct" | "possession" | "counter" | "mixed";
export type DefensiveStyle = "high-line" | "mid-block" | "low-block" | "pressing";

export interface TeamAttackingCharacteristics {
  attackingStyle: AttackingStyle;
  shotVolume: number;
  shotAccuracy: number;
  bigChanceCreation: number;
  throughBallFrequency: number;
  crossingAccuracy: number;
  setPieceAttack: number;
}

export interface TeamDefendingCharacteristics {
  defensiveStyle: DefensiveStyle;
  cleanSheetRate: number;
  tacklesPerGame: number;
  interceptionsPerGame: number;
  aerialDuelsWon: number;
  pressureIntensity: number;
}

export interface TeamGoalsCharacteristics {
  goalsScoredAvg: number;
  goalsConcededAvg: number;
  goalConversionRate: number;
  xGPerGame: number;
  xGAConcededPerGame: number;
}

export interface TeamOffsideCharacteristics {
  offsidesPerGame: number;
  offsideTrapSuccess: number;
}

export interface TeamThroughPassingCharacteristics {
  throughBallsPerGame: number;
  keyPassesPerGame: number;
  progressivePassesPerGame: number;
}

export interface TeamShootingCharacteristics {
  shotsOnTargetPerGame: number;
  shotsOutsideBoxPerGame: number;
  longRangeThreat: number;
}

export interface TeamAdditionalCharacteristics {
  possessionAvg: number;
  passAccuracy: number;
  counterAttackEfficiency: number;
  homePerformance: number;
  awayPerformance: number;
  recentForm: number;
  discipline: number;
}

export interface TeamCharacteristics {
  clubId: string;
  clubName: string;
  league: string;
  lastUpdated: string;
  matchSamples: number;
  attacking: TeamAttackingCharacteristics;
  defending: TeamDefendingCharacteristics;
  goals: TeamGoalsCharacteristics;
  offside: TeamOffsideCharacteristics;
  throughPassing: TeamThroughPassingCharacteristics;
  shooting: TeamShootingCharacteristics;
  additional: TeamAdditionalCharacteristics;
}

export interface TeamCharacteristicsStore {
  schemaVersion: number;
  updatedAt: string;
  teams: Record<string, TeamCharacteristics>;
  /** Field paths the user edited manually — preserved on recompute. */
  manualFields: Record<string, string[]>;
}

/** AI Learner — persisted personal learning statistics (local only). */
export const LEARNER_SCHEMA_VERSION = 1;

export interface OddsRangeLearnerStat {
  band: OddsBandId;
  wins: number;
  losses: number;
  winRate: number | null;
  sample: number;
}

export interface BatchPatternStat {
  label: string;
  totalBatches: number;
  winningBatches: number;
  winRate: number | null;
  lowSample: boolean;
}

export interface ClubCautionStat {
  clubName: string;
  league: string;
  winRate: number | null;
  sample: number;
  reason: string;
}

export interface LearnerAdvice {
  topReliableRanges: Array<{ band: OddsBandId; winRate: number; sample: number }>;
  cautiousClubs: ClubCautionStat[];
  suggestedCombinedOddsCeiling: number;
  batchPatternWarnings: string[];
  summaryLine: string;
}

export interface LearnerStatsStore {
  schemaVersion: number;
  updatedAt: string;
  learnerVersion: number;
  totalBatchesWithResults: number;
  totalScoredPicks: number;
  oddsRanges: OddsRangeLearnerStat[];
  topReliableRanges: OddsBandId[];
  weakestRanges: OddsBandId[];
  batchPatterns: BatchPatternStat[];
  cautiousClubs: ClubCautionStat[];
  suggestedCombinedOddsCeiling: number;
  comboTypeStats?: Record<string, ComboTypeLearnerStat>;
  correctScoreStats?: CorrectScoreStats;
  advice: LearnerAdvice;
}

export interface LuckyNumbersStore {
  schemaVersion: number;
  updatedAt: string;
  numbers: number[];
}
