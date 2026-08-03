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

/** Isolated bet-tracking tables — never written by Prediction Log. */
export const betEvents = pgTable(
  "bet_events",
  {
    id: serial("id").primaryKey(),
    apiFixtureId: integer("api_fixture_id").notNull().unique(),
    leagueId: integer("league_id").notNull(),
    home: text("home").notNull(),
    away: text("away").notNull(),
    kickoffUtc: timestamp("kickoff_utc", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("NS"),
    minute: integer("minute"),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    feedType: text("feed_type").notNull().default("PRE"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    kickoffIdx: index("bet_events_kickoff_idx").on(t.kickoffUtc),
    statusIdx: index("bet_events_status_idx").on(t.status),
    feedIdx: index("bet_events_feed_idx").on(t.feedType),
  })
);

export const betMarkets = pgTable(
  "bet_markets",
  {
    id: serial("id").primaryKey(),
    betEventId: integer("bet_event_id").notNull(),
    marketType: text("market_type").notNull(),
    selectionLabel: text("selection_label").notNull(),
    odd: real("odd"),
    isAvailable: integer("is_available").notNull().default(1),
    source: text("source").notNull().default("MANUAL"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    eventIdx: index("bet_markets_event_idx").on(t.betEventId),
    marketIdx: index("bet_markets_type_idx").on(t.betEventId, t.marketType, t.selectionLabel),
  })
);

export const betSlips = pgTable(
  "bet_slips",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    slipType: text("slip_type").notNull().default("SINGLE"),
    stake: real("stake").notNull(),
    totalOdd: real("total_odd").notNull(),
    potentialReturn: real("potential_return").notNull(),
    status: text("status").notNull().default("OPEN"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    note: text("note"),
  },
  (t) => ({
    statusIdx: index("bet_slips_status_idx").on(t.status),
    createdIdx: index("bet_slips_created_idx").on(t.createdAt),
  })
);

export const betSelections = pgTable(
  "bet_selections",
  {
    id: serial("id").primaryKey(),
    betSlipId: integer("bet_slip_id").notNull(),
    betEventId: integer("bet_event_id").notNull(),
    marketId: integer("market_id").notNull(),
    chosenLabel: text("chosen_label").notNull(),
    chosenOdd: real("chosen_odd").notNull(),
    result: text("result").notNull().default("PENDING"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => ({
    slipIdx: index("bet_selections_slip_idx").on(t.betSlipId),
    eventIdx: index("bet_selections_event_idx").on(t.betEventId),
  })
);

export type BetEvent = typeof betEvents.$inferSelect;
export type NewBetEvent = typeof betEvents.$inferInsert;
export type BetMarket = typeof betMarkets.$inferSelect;
export type NewBetMarket = typeof betMarkets.$inferInsert;
export type BetSlip = typeof betSlips.$inferSelect;
export type NewBetSlip = typeof betSlips.$inferInsert;
export type BetSelection = typeof betSelections.$inferSelect;
export type NewBetSelection = typeof betSelections.$inferInsert;

/**
 * Historical AF seed tables — read-only reference for models.
 * Writers live only under lib/hist/. Never touch live_, bet_, match_stats, or pred-log.
 */
export const histFixtures = pgTable(
  "hist_fixtures",
  {
    fixtureId: integer("fixture_id").primaryKey(),
    leagueId: integer("league_id").notNull(),
    season: integer("season").notNull(),
    round: text("round"),
    dateUtc: timestamp("date_utc", { withTimezone: true }).notNull(),
    homeId: integer("home_id"),
    awayId: integer("away_id"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    venue: text("venue"),
    htHome: integer("ht_home"),
    htAway: integer("ht_away"),
    ftHome: integer("ft_home"),
    ftAway: integer("ft_away"),
    status: text("status").notNull(),
    dataCompleteness: text("data_completeness").notNull().default("core-only"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    leagueSeasonIdx: index("hist_fixtures_league_season_idx").on(
      t.leagueId,
      t.season
    ),
    dateIdx: index("hist_fixtures_date_idx").on(t.dateUtc),
  })
);

export const histGoals = pgTable(
  "hist_goals",
  {
    id: serial("id").primaryKey(),
    fixtureId: integer("fixture_id").notNull(),
    teamId: integer("team_id"),
    minute: integer("minute"),
    extraMinute: integer("extra_minute"),
    half: text("half").notNull(),
    player: text("player"),
    type: text("type"),
  },
  (t) => ({
    fixtureIdx: index("hist_goals_fixture_idx").on(t.fixtureId),
  })
);

export const histStats = pgTable(
  "hist_stats",
  {
    id: serial("id").primaryKey(),
    fixtureId: integer("fixture_id").notNull(),
    teamId: integer("team_id").notNull(),
    shots: integer("shots"),
    sot: integer("sot"),
    possession: integer("possession"),
    corners: integer("corners"),
    yellow: integer("yellow"),
    red: integer("red"),
    fouls: integer("fouls"),
    offsides: integer("offsides"),
  },
  (t) => ({
    fixtureTeamIdx: index("hist_stats_fixture_team_idx").on(
      t.fixtureId,
      t.teamId
    ),
  })
);

export const histLineups = pgTable(
  "hist_lineups",
  {
    id: serial("id").primaryKey(),
    fixtureId: integer("fixture_id").notNull(),
    teamId: integer("team_id").notNull(),
    formation: text("formation"),
  },
  (t) => ({
    fixtureTeamIdx: index("hist_lineups_fixture_team_idx").on(
      t.fixtureId,
      t.teamId
    ),
  })
);

export const histTeams = pgTable("hist_teams", {
  teamId: integer("team_id").primaryKey(),
  name: text("name").notNull(),
  logo: text("logo"),
  country: text("country"),
  firstSeenSeason: integer("first_seen_season"),
});

export const histJobs = pgTable(
  "hist_jobs",
  {
    leagueId: integer("league_id").notNull(),
    season: integer("season").notNull(),
    leagueName: text("league_name").notNull(),
    status: text("status").notNull().default("pending"),
    cursorFixtureId: integer("cursor_fixture_id"),
    fixturesTotal: integer("fixtures_total").notNull().default(0),
    fixturesImported: integer("fixtures_imported").notNull().default(0),
    goalsImported: integer("goals_imported").notNull().default(0),
    statsImported: integer("stats_imported").notNull().default(0),
    skipReason: text("skip_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.leagueId, t.season],
      name: "hist_jobs_pk",
    }),
    statusIdx: index("hist_jobs_status_idx").on(t.status),
  })
);

export const histMeta = pgTable("hist_meta", {
  id: integer("id").primaryKey().default(1),
  plan: text("plan"),
  limitDay: integer("limit_day"),
  remaining: integer("remaining"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSummary: text("last_summary"),
  beta2hJson: text("beta_2h_json"),
  leaguePriorsJson: text("league_priors_json"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * Persisted venue-split half intensities derived from hist_*.
 * Models read; writers under lib/hist/ only.
 */
export const teamHalfStats = pgTable(
  "team_half_stats",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id"),
    teamName: text("team_name").notNull(),
    leagueId: integer("league_id").notNull(),
    venue: text("venue").notNull(),
    scored1h: real("scored_1h").notNull(),
    scored2h: real("scored_2h").notNull(),
    conceded1h: real("conceded_1h").notNull(),
    conceded2h: real("conceded_2h").notNull(),
    sampleSize: integer("sample_size").notNull(),
    thinData: integer("thin_data").notNull().default(0),
    lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull(),
  },
  (t) => ({
    teamLeagueVenueIdx: index("team_half_stats_team_league_venue_idx").on(
      t.teamName,
      t.leagueId,
      t.venue
    ),
    leagueIdx: index("team_half_stats_league_idx").on(t.leagueId),
  })
);

export type HistFixture = typeof histFixtures.$inferSelect;
export type NewHistFixture = typeof histFixtures.$inferInsert;
export type HistGoal = typeof histGoals.$inferSelect;
export type NewHistGoal = typeof histGoals.$inferInsert;
export type HistStat = typeof histStats.$inferSelect;
export type NewHistStat = typeof histStats.$inferInsert;
export type HistLineup = typeof histLineups.$inferSelect;
export type NewHistLineup = typeof histLineups.$inferInsert;
export type HistTeam = typeof histTeams.$inferSelect;
export type NewHistTeam = typeof histTeams.$inferInsert;
export type HistJob = typeof histJobs.$inferSelect;
export type NewHistJob = typeof histJobs.$inferInsert;
export type HistMeta = typeof histMeta.$inferSelect;
export type NewHistMeta = typeof histMeta.$inferInsert;
export type TeamHalfStat = typeof teamHalfStats.$inferSelect;
export type NewTeamHalfStat = typeof teamHalfStats.$inferInsert;
