/** Normalized secondary match payload (The Stats API → merge layer). */
export interface StatsApiMatch {
  /** Stats API match id, e.g. `mt_838955483` */
  id: string;
  year: number | null;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
  status: string | null;
  minute: number | null;
  date: string | null;

  // Core
  homeCorners: number | null;
  awayCorners: number | null;
  homeShots: number | null;
  awayShots: number | null;
  homePossession: number | null;
  awayPossession: number | null;

  // Overview extras (nullable)
  homeShotsOnTarget: number | null;
  awayShotsOnTarget: number | null;
  homeXg: number | null;
  awayXg: number | null;
  homeBigChances: number | null;
  awayBigChances: number | null;
  homeGkSaves: number | null;
  awayGkSaves: number | null;
  homeFouls: number | null;
  awayFouls: number | null;
  homeYellowCards: number | null;
  awayYellowCards: number | null;
  homeRedCards: number | null;
  awayRedCards: number | null;
  homePasses: number | null;
  awayPasses: number | null;
  homeAccuratePasses: number | null;
  awayAccuratePasses: number | null;
  homeTackles: number | null;
  awayTackles: number | null;
  homeFreeKicks: number | null;
  awayFreeKicks: number | null;

  /** Serialized `/stats` data root when available. */
  rawJson: string | null;
  raw?: unknown;
}

/** Day-list row used only for ID discovery. */
export interface StatsApiDayMatch {
  id: string;
  year: number | null;
  homeTeam: string;
  awayTeam: string;
  date: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  status: string | null;
}

export interface LiveSourceConflict {
  field: string;
  apiFootball: unknown;
  /** Secondary provider value (The Stats API). */
  beSoccer: unknown;
}

/** Numeric match-stat pairs persisted on match_stats / enrichment. */
export interface MergedMatchStats {
  homeCorners: number | null;
  awayCorners: number | null;
  homeShots: number | null;
  awayShots: number | null;
  homePossession: number | null;
  awayPossession: number | null;
  homeShotsOnTarget: number | null;
  awayShotsOnTarget: number | null;
  homeXg: number | null;
  awayXg: number | null;
  homeBigChances: number | null;
  awayBigChances: number | null;
  homeGkSaves: number | null;
  awayGkSaves: number | null;
  homeFouls: number | null;
  awayFouls: number | null;
  homeYellowCards: number | null;
  awayYellowCards: number | null;
  homeRedCards: number | null;
  awayRedCards: number | null;
  homePasses: number | null;
  awayPasses: number | null;
  homeAccuratePasses: number | null;
  awayAccuratePasses: number | null;
  homeTackles: number | null;
  awayTackles: number | null;
  homeFreeKicks: number | null;
  awayFreeKicks: number | null;
  rawJson: string | null;
}

export function emptyMergedMatchStats(): MergedMatchStats {
  return {
    homeCorners: null,
    awayCorners: null,
    homeShots: null,
    awayShots: null,
    homePossession: null,
    awayPossession: null,
    homeShotsOnTarget: null,
    awayShotsOnTarget: null,
    homeXg: null,
    awayXg: null,
    homeBigChances: null,
    awayBigChances: null,
    homeGkSaves: null,
    awayGkSaves: null,
    homeFouls: null,
    awayFouls: null,
    homeYellowCards: null,
    awayYellowCards: null,
    homeRedCards: null,
    awayRedCards: null,
    homePasses: null,
    awayPasses: null,
    homeAccuratePasses: null,
    awayAccuratePasses: null,
    homeTackles: null,
    awayTackles: null,
    homeFreeKicks: null,
    awayFreeKicks: null,
    rawJson: null,
  };
}
