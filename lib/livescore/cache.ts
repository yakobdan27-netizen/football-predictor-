import { getJson, setJsonEx } from "@/lib/prediction-log/kv";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";
import type { LivescoreScrapeResult } from "./types";

const TTL_SECONDS = 7 * 24 * 60 * 60;

function normPart(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function cacheKeyForEvent(eventId: string): string {
  return KV_KEYS.livescoreCache(`eid:${eventId}`);
}

export function cacheKeyForTeams(date: string, home: string, away: string): string {
  const d = date.replace(/[^0-9]/g, "").slice(0, 8);
  return KV_KEYS.livescoreCache(`pair:${d}:${normPart(home)}:${normPart(away)}`);
}

export async function getCachedScrape(
  eventId?: string | null,
  date?: string,
  home?: string,
  away?: string
): Promise<LivescoreScrapeResult | null> {
  if (eventId) {
    const hit = await getJson<LivescoreScrapeResult>(cacheKeyForEvent(eventId));
    if (hit) return hit;
  }
  if (date && home && away) {
    return getJson<LivescoreScrapeResult>(cacheKeyForTeams(date, home, away));
  }
  return null;
}

export async function setCachedScrape(result: LivescoreScrapeResult): Promise<void> {
  await setJsonEx(cacheKeyForEvent(result.eventId), result, TTL_SECONDS);
  if (result.matchDate && result.homeTeam && result.awayTeam) {
    await setJsonEx(
      cacheKeyForTeams(result.matchDate, result.homeTeam, result.awayTeam),
      result,
      TTL_SECONDS
    );
  }
}
