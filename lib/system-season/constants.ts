/** Dedicated 2026/27 system corpus season (40% blend side). */
export const SYSTEM_SEASON_LABEL = "2026/27" as const;
export const SYSTEM_SEASON_YEAR = 2026;
export const SYSTEM_SEASON_WINDOW = {
  from: "2026-08-01",
  to: "2027-08-01",
} as const;

export const SYSTEM_SEASON_MIN_MATCHES = 3;
export const SYSTEM_SEASON_MAX_ENRICH_PER_RUN = 6;
export const SYSTEM_SEASON_ENRICH_SLEEP_MS = 150;

export function isInSystemSeasonWindow(date: string): boolean {
  return date >= SYSTEM_SEASON_WINDOW.from && date < SYSTEM_SEASON_WINDOW.to;
}
