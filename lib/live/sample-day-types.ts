export type SampleDayMatch = {
  fixtureId: number;
  leagueId: number;
  leagueName: string;
  kickoffUtc: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
  /** True when a `match_stats` row exists for this fixture. */
  hasMatchStats: boolean;
  statsApiMatchId?: string | null;
  homeCorners?: number | null;
  awayCorners?: number | null;
  homeShots?: number | null;
  awayShots?: number | null;
  homePossession?: number | null;
  awayPossession?: number | null;
};

export type SampleDayPreviewSource = "database" | "api";

export type SampleDayPreview = {
  ok: boolean;
  date: string;
  season: number;
  matchCount: number;
  matches: SampleDayMatch[];
  /** Where the list came from for this response. */
  source?: SampleDayPreviewSource;
  /** How many listed fixtures already have a match_stats row. */
  withMatchStatsCount?: number;
  forced?: boolean;
  error?: string;
  warning?: string;
};
