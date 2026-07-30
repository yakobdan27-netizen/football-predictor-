export type RefreshStepStatus =
  | "pending"
  | "running"
  | "done"
  | "skipped"
  | "error";

export interface RefreshStep {
  id: string;
  label: string;
  status: RefreshStepStatus;
  detail?: string;
}

export interface RefreshFixtureResult {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  status: string;
  homeGoals: number | null;
  awayGoals: number | null;
  besoccerMatchId: string | null;
  homeCorners: number | null;
  awayCorners: number | null;
  homeShots: number | null;
  awayShots: number | null;
  homePossession: number | null;
  awayPossession: number | null;
  sourceConflicts: Array<{
    field: string;
    apiFootball: unknown;
    beSoccer: unknown;
  }>;
}

/** Manual Live Refresh only samples free-plan dates (2022–2024). */
export type ManualRefreshMode = "sample-day";

export interface ManualRefreshSummary {
  ok: boolean;
  mode: ManualRefreshMode;
  sampleDate?: string | null;
  upserted: number;
  settledEmitted: number;
  skippedRun?: boolean;
  inserted?: number;
  updated?: number;
  skipped?: number;
  warning?: string;
  error?: string;
  beSoccerConfigured: boolean;
  steps: RefreshStep[];
  apiFootballFetched: number;
  beSoccerMapped: number;
  beSoccerFetched: number;
  beSoccerSkippedSeason: number;
  conflictCount: number;
  fixtures: RefreshFixtureResult[];
  discoverFrom?: string | null;
  discoverTo?: string | null;
  discoverCount?: number;
  truncated?: boolean;
  /** Rows found in live_fixtures after upsert (readback). */
  dbConfirmedRows?: number;
  /** Rows with Stats API id and/or numeric match stats in DB. */
  dbConfirmedStats?: number;
  startedAt: string;
  finishedAt: string;
}
