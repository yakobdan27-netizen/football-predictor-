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
    season?: number;
  };
  teams: {
    home: { id?: number | null; name: string; logo?: string | null };
    away: { id?: number | null; name: string; logo?: string | null };
  };
  goals: { home: number | null; away: number | null };
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
  lastSyncedUtc: string;
  leagueName?: string | null;
  leagueLogoUrl?: string | null;
}

export interface LiveEventDto {
  id: number;
  fixtureId: number;
  minute: number | null;
  type: string | null;
  team: string | null;
  player: string | null;
}
