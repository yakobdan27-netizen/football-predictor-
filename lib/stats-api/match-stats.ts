import { statsApiGet } from "./client";
import { parseStatsApiMatchStats } from "./parse";
import type { StatsApiMatch } from "./types";

/**
 * Fetch match statistics for one fixture.
 * Stats are only available per-match (no bulk `/stats` endpoint):
 * primary `GET /football/matches/{id}/stats`
 * fallback `GET /football/matches/{id}/live-stats` when post-match stats unavailable.
 *
 * Skips the match detail call — scores/teams come from API-Football; we only
 * need corners/shots/possession from Stats API (saves 1 req per fixture).
 */
export async function fetchStatsApiMatch(
  matchId: string
): Promise<StatsApiMatch | null> {
  const id = matchId.trim();
  if (!id) return null;

  let statsPayload: unknown = null;
  let liveStatsPayload: unknown = null;

  try {
    statsPayload = await statsApiGet(
      `/football/matches/${encodeURIComponent(id)}/stats`
    );
  } catch {
    try {
      liveStatsPayload = await statsApiGet(
        `/football/matches/${encodeURIComponent(id)}/live-stats`
      );
    } catch {
      return null;
    }
  }

  return parseStatsApiMatchStats({
    matchId: id,
    statsPayload,
    liveStatsPayload,
  });
}
