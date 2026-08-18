/** Raw API-Football fixture shape used by the live module. */
export interface LiveApiFixture {
  fixture: {
    id: number;
    date: string;
    status: {
      short?: string | null;
      elapsed?: number | null;
    };
    venue?: { name?: string | null; city?: string | null };
  };
  league?: {
    id?: number;
    name?: string;
    country?: string;
    logo?: string | null;
    type?: string;
    round?: string;
    season?: number;
  };
  teams: {
    home: { id?: number | null; name: string; logo?: string | null };
    away: { id?: number | null; name: string; logo?: string | null };
  };
  goals: { home: number | null; away: number | null };
  score?: {
    halftime?: { home?: number | null; away?: number | null };
    fulltime?: { home?: number | null; away?: number | null };
  };
}

export interface LiveApiEvent {
  time?: { elapsed?: number | null; extra?: number | null };
  team?: { name?: string | null };
  player?: { name?: string | null };
  type?: string | null;
  detail?: string | null;
}

export type LiveTab = "live" | "today" | "upcoming" | "finished";

export interface LiveSyncMetaDto {
  lastSyncAt: string | null;
  status: "ok" | "empty" | "error" | "quota" | "auth" | null;
  reason: string | null;
  from: string | null;
  to: string | null;
  fetched: number | null;
  upserted: number | null;
}

export interface LiveSourceConflictDto {
  field: string;
  apiFootball: unknown;
  beSoccer: unknown;
}

export interface LiveFixtureDto {
  fixtureId: number;
  leagueId: number;
  season: number;
  homeTeam: string;
  awayTeam: string;
  homeId: number | null;
  awayId: number | null;
  kickoffUtc: string;
  venue: string | null;
  status: string;
  statusMinute: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  besoccerMatchId?: string | null;
  homeCorners?: number | null;
  awayCorners?: number | null;
  homeShots?: number | null;
  awayShots?: number | null;
  homePossession?: number | null;
  awayPossession?: number | null;
  sourceConflicts?: LiveSourceConflictDto[];
  lastSyncedUtc: string;
  leagueName?: string | null;
  leagueLogoUrl?: string | null;
}

/** Optional Stats API enrichments applied after API-Football normalize. */
export interface LiveBeSoccerEnrichment {
  /** Stats API match id (`mt_…`); column still named besoccer_match_id. */
  besoccerMatchId: string | null;
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
  sourceConflicts: LiveSourceConflictDto[];
}

export interface LiveEventDto {
  id: number;
  fixtureId: number;
  minute: number | null;
  type: string | null;
  team: string | null;
  player: string | null;
}
