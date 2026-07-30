import {
  pgTable,
  serial,
  text,
  integer,
  date,
  timestamp,
  real,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  matchDate: date("match_date"),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  fthg: integer("fthg").notNull(),
  ftag: integer("ftag").notNull(),
  hthg: integer("hthg"),
  htag: integer("htag"),
  hs: integer("hs"),
  awayShots: integer("away_shots"),
  hst: integer("hst"),
  ast: integer("ast"),
  ho: integer("ho"),
  ao: integer("ao"),
  hc: integer("hc"),
  ac: integer("ac"),
  hti: integer("hti"),
  ati: integer("ati"),
  b365Home: real("b365_home"),
  b365Draw: real("b365_draw"),
  b365Away: real("b365_away"),
  b365Over25: real("b365_over25"),
  b365Under25: real("b365_under25"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;

/** Isolated live-mirror tables — never written by Prediction Log / manual fill. */
export const liveLeagues = pgTable("live_leagues", {
  leagueId: integer("league_id").primaryKey(),
  name: text("name").notNull(),
  country: text("country"),
  season: integer("season").notNull(),
  logoUrl: text("logo_url"),
});

export const liveFixtures = pgTable(
  "live_fixtures",
  {
    fixtureId: integer("fixture_id").primaryKey(),
    leagueId: integer("league_id").notNull(),
    season: integer("season").notNull(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    homeId: integer("home_id"),
    awayId: integer("away_id"),
    kickoffUtc: timestamp("kickoff_utc", { withTimezone: true }).notNull(),
    venue: text("venue"),
    status: text("status").notNull(),
    statusMinute: integer("status_minute"),
    homeGoals: integer("home_goals"),
    awayGoals: integer("away_goals"),
    besoccerMatchId: text("besoccer_match_id"),
    homeCorners: integer("home_corners"),
    awayCorners: integer("away_corners"),
    homeShots: integer("home_shots"),
    awayShots: integer("away_shots"),
    homePossession: integer("home_possession"),
    awayPossession: integer("away_possession"),
    sourceConflicts: text("source_conflicts"),
    lastSyncedUtc: timestamp("last_synced_utc", { withTimezone: true }).notNull(),
    settledEmittedAt: timestamp("settled_emitted_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("live_fixtures_status_idx").on(t.status),
    kickoffIdx: index("live_fixtures_kickoff_idx").on(t.kickoffUtc),
    leagueSeasonIdx: index("live_fixtures_league_season_idx").on(
      t.leagueId,
      t.season
    ),
  })
);

export const liveEvents = pgTable(
  "live_events",
  {
    id: serial("id").primaryKey(),
    fixtureId: integer("fixture_id").notNull(),
    minute: integer("minute"),
    type: text("type"),
    team: text("team"),
    player: text("player"),
  },
  (t) => ({
    fixtureIdx: index("live_events_fixture_idx").on(t.fixtureId),
  })
);

/** Singleton row (id=1) for schedule sync diagnostics on /live. */
export const liveSyncMeta = pgTable("live_sync_meta", {
  id: integer("id").primaryKey().default(1),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncStatus: text("last_sync_status"),
  lastSyncReason: text("last_sync_reason"),
  lastFrom: date("last_from"),
  lastTo: date("last_to"),
  lastFetched: integer("last_fetched"),
  lastUpserted: integer("last_upserted"),
});

export type LiveLeague = typeof liveLeagues.$inferSelect;
export type NewLiveLeague = typeof liveLeagues.$inferInsert;
export type LiveFixture = typeof liveFixtures.$inferSelect;
export type NewLiveFixture = typeof liveFixtures.$inferInsert;
export type LiveEvent = typeof liveEvents.$inferSelect;
export type NewLiveEvent = typeof liveEvents.$inferInsert;
export type LiveSyncMeta = typeof liveSyncMeta.$inferSelect;
export type NewLiveSyncMeta = typeof liveSyncMeta.$inferInsert;

/**
 * Canonical match statistics from secondary providers (The Stats API).
 * Keyed by API-Football fixture_id. All stat columns are nullable so
 * partial provider payloads never break other backends.
 */
export const matchStats = pgTable(
  "match_stats",
  {
    fixtureId: integer("fixture_id").primaryKey(),
    statsApiMatchId: text("stats_api_match_id"),
    leagueId: integer("league_id"),
    season: integer("season"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    kickoffUtc: timestamp("kickoff_utc", { withTimezone: true }),
    status: text("status"),
    homeGoals: integer("home_goals"),
    awayGoals: integer("away_goals"),

    // Core (already used by Live UI mirror)
    homeCorners: integer("home_corners"),
    awayCorners: integer("away_corners"),
    homeShots: integer("home_shots"),
    awayShots: integer("away_shots"),
    homePossession: integer("home_possession"),
    awayPossession: integer("away_possession"),

    // Stats API overview — full-match (`all`) pairs
    homeShotsOnTarget: integer("home_shots_on_target"),
    awayShotsOnTarget: integer("away_shots_on_target"),
    homeXg: real("home_xg"),
    awayXg: real("away_xg"),
    homeBigChances: integer("home_big_chances"),
    awayBigChances: integer("away_big_chances"),
    homeGkSaves: integer("home_gk_saves"),
    awayGkSaves: integer("away_gk_saves"),
    homeFouls: integer("home_fouls"),
    awayFouls: integer("away_fouls"),
    homeYellowCards: integer("home_yellow_cards"),
    awayYellowCards: integer("away_yellow_cards"),
    homeRedCards: integer("home_red_cards"),
    awayRedCards: integer("away_red_cards"),
    homePasses: integer("home_passes"),
    awayPasses: integer("away_passes"),
    homeAccuratePasses: integer("home_accurate_passes"),
    awayAccuratePasses: integer("away_accurate_passes"),
    homeTackles: integer("home_tackles"),
    awayTackles: integer("away_tackles"),
    homeFreeKicks: integer("home_free_kicks"),
    awayFreeKicks: integer("away_free_kicks"),

    /** Optional full `/stats` data blob for fields we don't columnize yet. */
    rawJson: text("raw_json"),
    sourceConflicts: text("source_conflicts"),
    provider: text("provider").notNull().default("thestatsapi"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    leagueSeasonIdx: index("match_stats_league_season_idx").on(
      t.leagueId,
      t.season
    ),
    kickoffIdx: index("match_stats_kickoff_idx").on(t.kickoffUtc),
    statsApiIdIdx: index("match_stats_stats_api_id_idx").on(t.statsApiMatchId),
  })
);

export type MatchStats = typeof matchStats.$inferSelect;
export type NewMatchStats = typeof matchStats.$inferInsert;

/** Singleton cursor for overnight historical stats backfill (id=1). */
export const statsBackfillMeta = pgTable("stats_backfill_meta", {
  id: integer("id").primaryKey().default(1),
  phase: text("phase").notNull().default("inventory"),
  cellIndex: integer("cell_index").notNull().default(0),
  leagueId: integer("league_id"),
  season: integer("season"),
  lastError: text("last_error"),
  lastSummary: text("last_summary"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export type StatsBackfillMeta = typeof statsBackfillMeta.$inferSelect;
export type NewStatsBackfillMeta = typeof statsBackfillMeta.$inferInsert;

/**
 * Per-team × league × season averages from match_stats (recommendation priors).
 */
export const teamSeasonStats = pgTable(
  "team_season_stats",
  {
    teamName: text("team_name").notNull(),
    leagueId: integer("league_id").notNull(),
    season: integer("season").notNull(),
    afTeamId: integer("af_team_id"),
    matches: integer("matches").notNull().default(0),
    homeMatches: integer("home_matches").notNull().default(0),
    awayMatches: integer("away_matches").notNull().default(0),
    avgGoalsFor: real("avg_goals_for"),
    avgGoalsAgainst: real("avg_goals_against"),
    avgXgFor: real("avg_xg_for"),
    avgXgAgainst: real("avg_xg_against"),
    avgShotsFor: real("avg_shots_for"),
    avgShotsAgainst: real("avg_shots_against"),
    avgShotsOnTargetFor: real("avg_shots_on_target_for"),
    avgShotsOnTargetAgainst: real("avg_shots_on_target_against"),
    avgCornersFor: real("avg_corners_for"),
    avgCornersAgainst: real("avg_corners_against"),
    avgPossession: real("avg_possession"),
    avgFoulsFor: real("avg_fouls_for"),
    avgYellowCardsFor: real("avg_yellow_cards_for"),
    avgRedCardsFor: real("avg_red_cards_for"),
    avgPassesFor: real("avg_passes_for"),
    avgTacklesFor: real("avg_tackles_for"),
    homeAvgGoalsFor: real("home_avg_goals_for"),
    homeAvgCornersFor: real("home_avg_corners_for"),
    homeAvgShotsOnTargetFor: real("home_avg_shots_on_target_for"),
    awayAvgGoalsFor: real("away_avg_goals_for"),
    awayAvgCornersFor: real("away_avg_corners_for"),
    awayAvgShotsOnTargetFor: real("away_avg_shots_on_target_for"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.teamName, t.leagueId, t.season],
      name: "team_season_stats_pk",
    }),
    leagueSeasonIdx: index("team_season_stats_league_season_idx").on(
      t.leagueId,
      t.season
    ),
  })
);

export type TeamSeasonStats = typeof teamSeasonStats.$inferSelect;
export type NewTeamSeasonStats = typeof teamSeasonStats.$inferInsert;
