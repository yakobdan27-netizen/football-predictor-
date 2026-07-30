export {
  statsApiGet,
  getStatsApiKey,
  peekStatsApiKey,
  isStatsApiConfigured,
  isStatsApiKeyError,
  STATS_API_KEY_NOT_CONFIGURED_MSG,
} from "./client";
export { fetchStatsApiMatch } from "./match-stats";
export {
  discoverStatsApiDayMatches,
  discoverStatsApiMatches,
  statsApiDefaultDateRange,
  STATS_API_LOOKBACK_DAYS,
  todayUtc,
  addDaysUtc,
} from "./discover";
export { mapStatsApiIds } from "./map-ids";
export {
  AF_TO_STATS_API_COMPETITION,
  AF_PREMIER_LEAGUE_ID,
  STATS_API_PL_COMPETITION_ID,
  statsApiCompetitionIdForAfLeague,
  statsApiCompetitionIdsForAfLeagues,
  statsApiTrackedCompetitionIds,
} from "./competitions";
export type {
  StatsApiMatch,
  StatsApiDayMatch,
  LiveSourceConflict,
  MergedMatchStats,
} from "./types";
export { emptyMergedMatchStats } from "./types";

/** @deprecated Compatibility aliases while callers migrate from BeSoccer names. */
export {
  isStatsApiConfigured as isBeSoccerConfigured,
  peekStatsApiKey as peekBeSoccerKey,
  STATS_API_KEY_NOT_CONFIGURED_MSG as BESOCCER_KEY_NOT_CONFIGURED_MSG,
} from "./client";
export { fetchStatsApiMatch as fetchBeSoccerMatch } from "./match-stats";
export {
  discoverStatsApiDayMatches as discoverBeSoccerDayMatches,
  discoverStatsApiMatches as discoverBeSoccerMatches,
} from "./discover";
export { mapStatsApiIds as mapBeSoccerIds } from "./map-ids";
