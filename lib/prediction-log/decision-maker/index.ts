export {
  DECISION_MIN_CONFIDENCE,
  DECISION_MIN_SOURCES,
  type AggregatedMatchData,
  type DecisionBatchCaches,
  type DecisionFetchContext,
  type DecisionMarketCandidate,
  type DecisionMarketCategory,
  type MatchDecisionRow,
  type MatchSourceBundle,
  type ResultPageDefinition,
  type ScoredDecisionMarket,
  type UserMarketEvaluation,
} from "./types";
export { bandToConfidence, clampConfidence, confidenceTone } from "./confidence";
export {
  categoryForLogMarket,
  categoryForMarketKey,
  categoryIcon,
  marketIdentity,
} from "./market-category";
export {
  RESULT_PAGE_REGISTRY,
  listRegisteredResultPages,
} from "./result-page-registry";
export { buildDecisionBatchCaches } from "./build-batch-caches";
export {
  aggregateMatchData,
  ensureThreeMarkets,
  generateTopThreeMarkets,
  normalisedSourceWeights,
  selectDiverseTopThree,
} from "./decision-engine";
export {
  processAllBatchesDecisions,
  processBatchDecisions,
} from "./process-batch";
export {
  comboOverlapsTopThree,
  pickMandatoryCombo,
  relatedMarketKeysForCombo,
} from "./combo-exclude";
export {
  buildUserMarketEvaluation,
  computeRowConfidenceScore,
  formatUserMarketEvalLine,
  USER_MARKET_EVAL_MAX_COMMENT,
} from "./user-market-evaluation";
