import { LEAGUE_API_IDS } from "@/lib/football-api/leagues";

/** Domestic leagues mirrored on the Live page (same set as Next Matches). */
export const LIVE_SYNC_LEAGUES = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
] as const;

export type LiveSyncLeague = (typeof LIVE_SYNC_LEAGUES)[number];

export const LIVE_LEAGUE_IDS: number[] = LIVE_SYNC_LEAGUES.map(
  (name) => LEAGUE_API_IDS[name]
);

export const LIVE_STATUSES = {
  inPlay: new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"]),
  finished: new Set(["FT", "AET", "PEN"]),
  scheduled: new Set(["NS", "TBD"]),
  disrupted: new Set(["PST", "CANC", "SUSP", "ABD"]),
} as const;

/** Stale thresholds for UI / API. */
export const STALE_MS = {
  live: 90_000,
  schedule: 25 * 60 * 60 * 1000,
} as const;
