import type {
  AnalysisHistory,
  CombinedOddsSettings,
  LearnerStatsStore,
  LogMatch,
  PredictionBatch,
} from "../types";
import type { TeamsQualityStore } from "../teams-quality-types";
import type { MatchComboResult } from "../combo-selection";
import type { HshPrediction } from "../hsh-model";
import type { CornersMatchPrediction } from "../corners-model";

/** Diversity buckets for top-3 selection. */
export type DecisionMarketCategory = "goals" | "corners" | "specialized";

export interface DecisionMarketCandidate {
  /** Stable id within a source (market key / combo id / model market). */
  marketKey: string;
  label: string;
  prediction: string;
  /** 0–100 confidence from the publishing page. */
  confidence: number;
  category: DecisionMarketCategory;
  pageId: string;
  pageLabel: string;
  line?: number;
}

export interface ScoredDecisionMarket extends DecisionMarketCandidate {
  totalScore: number;
  contributingPages: string[];
  /** +1 aligned with league prior, -1 fights, 0 neutral. */
  priorAlign?: number;
  /** Soft warning when pick fights league prior (never a block). */
  priorWarn?: string;
}

export interface DecisionFetchContext {
  batch: PredictionBatch;
  match: LogMatch;
  allBatches: PredictionBatch[];
  comboSettings: CombinedOddsSettings;
  learnerStats: LearnerStatsStore | null;
  analysis: AnalysisHistory | null;
  teamsQuality: TeamsQualityStore | null;
  caches: DecisionBatchCaches;
}

/** Per-batch precomputes so adapters stay O(1) per match. */
export interface DecisionBatchCaches {
  hshByMatchId: Map<string, HshPrediction>;
  cornersByMatchId: Map<string, CornersMatchPrediction>;
  comboByMatchId: Map<string, MatchComboResult>;
  comboExtendedByMatchId: Map<string, MatchComboResult>;
}

export interface ResultPageDefinition {
  pageId: string;
  pageLabel: string;
  href: string;
  /** Relative weight before normalisation across available sources. */
  baseWeight: number;
  fetchResults: (ctx: DecisionFetchContext) => DecisionMarketCandidate[];
}

export interface MatchSourceBundle {
  pageId: string;
  pageLabel: string;
  baseWeight: number;
  markets: DecisionMarketCandidate[];
  ok: boolean;
  error?: string;
}

export interface AggregatedMatchData {
  matchId: string;
  batchId: string;
  sources: MatchSourceBundle[];
}

export interface MatchDecisionRow {
  match: LogMatch;
  batchId: string;
  batchDisplayId: string;
  league: string;
  /** Exactly three markets from the Decision Maker engine. */
  markets: ScoredDecisionMarket[];
  /**
   * Mandatory 4th decision: best Combined Odds pick (exclude top-3 overlap when possible).
   * Null only when no combo candidates / no score grid.
   */
  bestCombined: MatchComboResult["selected"];
  /** Mandatory 5th decision: evaluate user's filled market, or "none". */
  userMarketEval: UserMarketEvaluation;
  /** Overall row confidence 0–100. */
  confidenceScore: number;
  sourceCount: number;
  missingSources: string[];
  incomplete: boolean;
}

export interface UserMarketEvaluation {
  status: "filled" | "none";
  marketKey?: string;
  marketLabel?: string;
  predictionLabel?: string;
  probabilityPct?: number;
  /** Short natural-language comment (≤140 chars). */
  comment: string;
}

export const DECISION_MIN_CONFIDENCE = 60;
export const DECISION_MIN_SOURCES = 2;
