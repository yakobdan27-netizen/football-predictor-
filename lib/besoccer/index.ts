/** Compatibility shim — secondary provider is now The Stats API. */
export {
  isStatsApiConfigured as isBeSoccerConfigured,
  peekStatsApiKey as peekBeSoccerKey,
  getStatsApiKey as getBeSoccerKey,
  statsApiGet as besoccerGet,
  STATS_API_KEY_NOT_CONFIGURED_MSG as BESOCCER_KEY_NOT_CONFIGURED_MSG,
  isStatsApiKeyError as isBeSoccerKeyError,
  fetchStatsApiMatch as fetchBeSoccerMatch,
  discoverStatsApiDayMatches as discoverBeSoccerDayMatches,
  mapStatsApiIds as mapBeSoccerIds,
} from "@/lib/stats-api";

export type {
  StatsApiMatch as BeSoccerMatch,
  StatsApiDayMatch as BeSoccerDayMatch,
  LiveSourceConflict,
  MergedMatchStats,
} from "@/lib/stats-api";

/** Season window no longer applies to The Stats API — always allow. */
export function besoccerYearForFixture(
  season?: number | null,
  _kickoffIso?: string | null
): number | null {
  if (season != null && Number.isFinite(season)) return season;
  return new Date().getUTCFullYear();
}

export function isBeSoccerSeasonAllowed(_year: number): boolean {
  return true;
}

export function besoccerAllowedSeasonYears(): {
  min: number;
  max: number;
  current: number;
} {
  const current = new Date().getUTCFullYear();
  return { min: current - 10, max: current + 1, current };
}
