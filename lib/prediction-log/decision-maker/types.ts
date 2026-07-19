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
import type { HcPrediction } from "../half-comparison-model";
import type { CornersMatchPrediction } from "../corners-model";
import type { ConcededHalfPrediction } from "../conceded-half-model";

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
  halfComparisonByMatchId: Map<string, HcPrediction>;
  cornersByMatchId: Map<string, CornersMatchPrediction>;
  concededByMatchId: Map<string, ConcededHalfPrediction>;
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
  markets: ScoredDecisionMarket[];
  sourceCount: number;
  missingSources: string[];
  incomplete: boolean;
}

export const DECISION_MIN_CONFIDENCE = 60;
export const DECISION_MIN_SOURCES = 2;
