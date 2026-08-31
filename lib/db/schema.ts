import {
  pgTable,
  serial,
  text,
  integer,
  date,
  timestamp,
  real,
  index,
  uniqueIndex,
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

/** External coupon users — isolated from personal bet_slips. */
export const extUsers = pgTable(
  "ext_users",
  {
    id: serial("id").primaryKey(),
    phone: text("phone").notNull().unique(),
    displayName: text("display_name"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    phoneIdx: index("ext_users_phone_idx").on(t.phone),
  })
);

export const extSlips = pgTable(
  "ext_slips",
  {
    id: serial("id").primaryKey(),
    extUserId: integer("ext_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    slipType: text("slip_type").notNull().default("MULTI"),
    stake: real("stake").notNull(),
    totalOdd: real("total_odd").notNull(),
    potentialReturn: real("potential_return").notNull(),
    note: text("note"),
    status: text("status").notNull().default("SUBMITTED"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("ext_slips_user_idx").on(t.extUserId),
    statusIdx: index("ext_slips_status_idx").on(t.status),
    createdIdx: index("ext_slips_created_idx").on(t.createdAt),
  })
);

export const extSelections = pgTable(
  "ext_selections",
  {
    id: serial("id").primaryKey(),
    extSlipId: integer("ext_slip_id").notNull(),
    betEventId: integer("bet_event_id"),
    marketId: integer("market_id"),
    eventLabel: text("event_label").notNull(),
    marketLabel: text("market_label").notNull(),
    chosenLabel: text("chosen_label").notNull(),
    chosenOdd: real("chosen_odd").notNull(),
    result: text("result").notNull().default("PENDING"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => ({
    slipIdx: index("ext_selections_slip_idx").on(t.extSlipId),
    eventIdx: index("ext_selections_event_idx").on(t.betEventId),
  })
);

export type ExtUser = typeof extUsers.$inferSelect;
export type NewExtUser = typeof extUsers.$inferInsert;
export type ExtSlip = typeof extSlips.$inferSelect;
export type NewExtSlip = typeof extSlips.$inferInsert;
export type ExtSelection = typeof extSelections.$inferSelect;
export type NewExtSelection = typeof extSelections.$inferInsert;

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
    /** league | cup — cup excluded from domestic intensity / BETA / priors. */
    compType: text("comp_type").notNull().default("league"),
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
    compTypeIdx: index("hist_fixtures_comp_type_idx").on(t.compType),
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
    /** Half-split corners only if API exposes them — else NULL. */
    htCorners: integer("ht_corners"),
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

/**
 * Dedicated 2026/27 current-season system corpus (40% blend side).
 * Writers: lib/system-season/ only. Separate from hist_* and KV batches.
 */
export const systemSeasonFixtures = pgTable(
  "system_season_fixtures",
  {
    fixtureId: integer("fixture_id").primaryKey(),
    leagueId: integer("league_id").notNull(),
    season: integer("season").notNull(),
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
    locked: integer("locked").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    leagueSeasonIdx: index("system_season_fixtures_league_season_idx").on(
      t.leagueId,
      t.season
    ),
    dateIdx: index("system_season_fixtures_date_idx").on(t.dateUtc),
    homeIdIdx: index("system_season_fixtures_home_id_idx").on(t.homeId),
    awayIdIdx: index("system_season_fixtures_away_id_idx").on(t.awayId),
  })
);

export const systemSeasonGoals = pgTable(
  "system_season_goals",
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
    fixtureIdx: index("system_season_goals_fixture_idx").on(t.fixtureId),
  })
);

export const systemSeasonStats = pgTable(
  "system_season_stats",
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
    fixtureTeamIdx: index("system_season_stats_fixture_team_idx").on(
      t.fixtureId,
      t.teamId
    ),
  })
);

export const systemSeasonLineups = pgTable(
  "system_season_lineups",
  {
    id: serial("id").primaryKey(),
    fixtureId: integer("fixture_id").notNull(),
    teamId: integer("team_id").notNull(),
    formation: text("formation"),
    startingJson: text("starting_json"),
    substitutesJson: text("substitutes_json"),
  },
  (t) => ({
    fixtureTeamIdx: index("system_season_lineups_fixture_team_idx").on(
      t.fixtureId,
      t.teamId
    ),
  })
);

export const systemSeasonTeamRates = pgTable(
  "system_season_team_rates",
  {
    teamId: integer("team_id").notNull(),
    leagueId: integer("league_id").notNull(),
    season: integer("season").notNull(),
    teamName: text("team_name").notNull(),
    nMatches: integer("n_matches").notNull().default(0),
    af1: real("af1"),
    af2: real("af2"),
    da1: real("da1"),
    da2: real("da2"),
    avgCornersFor: real("avg_corners_for"),
    avgCornersAgainst: real("avg_corners_against"),
    dataCompleteness: text("data_completeness").notNull().default("core-only"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.leagueId, t.season] }),
    leagueSeasonIdx: index("system_season_team_rates_league_season_idx").on(
      t.leagueId,
      t.season
    ),
  })
);

export const systemSeasonSyncMeta = pgTable(
  "system_season_sync_meta",
  {
    leagueId: integer("league_id").primaryKey(),
    season: integer("season").notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    fixturesSynced: integer("fixtures_synced").notNull().default(0),
    cursorFixtureId: integer("cursor_fixture_id"),
    backfillComplete: integer("backfill_complete").notNull().default(0),
  }
);

export type SystemSeasonFixture = typeof systemSeasonFixtures.$inferSelect;
export type NewSystemSeasonFixture = typeof systemSeasonFixtures.$inferInsert;
export type SystemSeasonGoal = typeof systemSeasonGoals.$inferSelect;
export type NewSystemSeasonGoal = typeof systemSeasonGoals.$inferInsert;
export type SystemSeasonStat = typeof systemSeasonStats.$inferSelect;
export type NewSystemSeasonStat = typeof systemSeasonStats.$inferInsert;
export type SystemSeasonLineup = typeof systemSeasonLineups.$inferSelect;
export type NewSystemSeasonLineup = typeof systemSeasonLineups.$inferInsert;
export type SystemSeasonTeamRate = typeof systemSeasonTeamRates.$inferSelect;
export type NewSystemSeasonTeamRate = typeof systemSeasonTeamRates.$inferInsert;
export type SystemSeasonSyncMeta = typeof systemSeasonSyncMeta.$inferSelect;

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
  /** Fitted ρ, corner dispersion, model version — see lib/hist/model-params.ts */
  modelParamsJson: text("model_params_json"),
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

/**
 * Per-competition half-share + DIEH dependence (κ), fitted from hist_fixtures.
 * Writers under lib/hist/ only — never hardcode shares/κ in model code.
 */
export const histLeagueHalfParams = pgTable(
  "hist_league_half_params",
  {
    leagueId: integer("league_id").notNull(),
    /** league | cup — cups fitted separately; never silently borrow domestic. */
    compType: text("comp_type").notNull().default("league"),
    leagueName: text("league_name").notNull(),
    /** Combined first-half share of total goals. */
    s1: real("s1").notNull(),
    s1Home: real("s1_home").notNull(),
    s1Away: real("s1_away").notNull(),
    usedCombinedShareHome: integer("used_combined_share_home").notNull().default(0),
    usedCombinedShareAway: integer("used_combined_share_away").notNull().default(0),
    nValid: integer("n_valid").notNull(),
    nHomeGoalsSample: integer("n_home_goals_sample").notNull().default(0),
    nAwayGoalsSample: integer("n_away_goals_sample").notNull().default(0),
    kappaRaw: real("kappa_raw").notNull(),
    kappaAdj: real("kappa_adj").notNull(),
    pD1Obs: real("p_d1_obs").notNull(),
    pD2Obs: real("p_d2_obs").notNull(),
    pD1d2Obs: real("p_d1d2_obs").notNull(),
    /** Total-goals overdispersion diagnostics for NegBin switch. */
    goalsMean: real("goals_mean"),
    goalsVariance: real("goals_variance"),
    goalsDispersion: real("goals_dispersion"),
    goalsDistribution: text("goals_distribution").notNull().default("poisson"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.leagueId, t.compType],
      name: "hist_league_half_params_pk",
    }),
  })
);

export type HistLeagueHalfParam = typeof histLeagueHalfParams.$inferSelect;
export type NewHistLeagueHalfParam = typeof histLeagueHalfParams.$inferInsert;

/** Precomputed attack/defence ratings — refresh on backfill / result fill. */
export const teamRatings = pgTable(
  "team_ratings",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id"),
    teamName: text("team_name").notNull(),
    leagueId: integer("league_id").notNull(),
    attackHome: real("attack_home").notNull(),
    attackAway: real("attack_away").notNull(),
    defenceHome: real("defence_home").notNull(),
    defenceAway: real("defence_away").notNull(),
    cornersIntensity: real("corners_intensity").notNull(),
    lambda1h: real("lambda_1h").notNull(),
    lambda2h: real("lambda_2h").notNull(),
    ess: real("ess").notNull(),
    seasonsUsed: integer("seasons_used").notNull(),
    matchesUsed: integer("matches_used").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    teamLeagueUniq: uniqueIndex("team_ratings_team_league_uidx").on(
      t.teamName,
      t.leagueId
    ),
    leagueIdx: index("team_ratings_league_idx").on(t.leagueId),
  })
);

export type TeamRating = typeof teamRatings.$inferSelect;
export type NewTeamRating = typeof teamRatings.$inferInsert;

/**
 * Portfolio slip batches — probability-only selection.
 * Never store bookmaker quotation or bankroll fields.
 */
export const slipBatches = pgTable(
  "slip_batches",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    preferencesJson: text("preferences_json").notNull(),
    userNote: text("user_note"),
    batchNumber: integer("batch_number").notNull(),
    fixtureExclusionIds: text("fixture_exclusion_ids"),
    partialReason: text("partial_reason"),
    regeneratedFromId: integer("regenerated_from_id"),
  },
  (t) => ({
    createdIdx: index("slip_batches_created_idx").on(t.createdAt),
  })
);

export const slipBatchLegs = pgTable(
  "slip_batch_legs",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull(),
    slipIndex: integer("slip_index").notNull(),
    legOrder: integer("leg_order").notNull(),
    fixtureId: text("fixture_id").notNull(),
    batchIdSource: text("batch_id_source"),
    competition: text("competition").notNull(),
    kickoffUtc: timestamp("kickoff_utc", { withTimezone: true }),
    marketFamily: text("market_family").notNull(),
    selectionLabel: text("selection_label").notNull(),
    selectionKey: text("selection_key").notNull(),
    line: real("line"),
    comboId: text("combo_id"),
    pCalibrated: real("p_calibrated").notNull(),
    pRaw: real("p_raw").notNull(),
    nEffective: real("n_effective").notNull(),
    calibrated: integer("calibrated").notNull().default(0),
    meanRho: real("mean_rho"),
    independenceUpper: real("independence_upper"),
    bandLower: real("band_lower"),
    bandUpper: real("band_upper"),
    selectionSource: text("selection_source").notNull().default("machine"),
    machineRank: integer("machine_rank"),
    correlationContribution: real("correlation_contribution"),
    homeTeam: text("home_team"),
    awayTeam: text("away_team"),
    outcome: text("outcome"),
  },
  (t) => ({
    batchIdx: index("slip_batch_legs_batch_idx").on(t.batchId),
    fixtureIdx: index("slip_batch_legs_fixture_idx").on(t.fixtureId),
  })
);

export type SlipBatchRow = typeof slipBatches.$inferSelect;
export type NewSlipBatchRow = typeof slipBatches.$inferInsert;
export type SlipBatchLegRow = typeof slipBatchLegs.$inferSelect;
export type NewSlipBatchLegRow = typeof slipBatchLegs.$inferInsert;

/* -------------------------------------------------------------------------- */
/* Additive core_* / audit_* — never replace legacy hist_/live_/bet_/KV paths */
/* -------------------------------------------------------------------------- */

export const coreCompetition = pgTable(
  "core_competition",
  {
    id: serial("id").primaryKey(),
    providerName: text("provider_name").notNull().default("api-sports"),
    providerCompetitionId: integer("provider_competition_id").notNull(),
    name: text("name").notNull(),
    country: text("country"),
    /** domestic_league | cup */
    compType: text("comp_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    providerUniq: uniqueIndex("core_competition_provider_uidx").on(
      t.providerName,
      t.providerCompetitionId
    ),
  })
);

export const coreSeason = pgTable(
  "core_season",
  {
    id: serial("id").primaryKey(),
    competitionId: integer("competition_id").notNull(),
    providerSeason: integer("provider_season").notNull(),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    compSeasonUniq: uniqueIndex("core_season_comp_season_uidx").on(
      t.competitionId,
      t.providerSeason
    ),
  })
);

export const coreTeam = pgTable(
  "core_team",
  {
    id: serial("id").primaryKey(),
    providerName: text("provider_name").notNull().default("api-sports"),
    providerTeamId: integer("provider_team_id").notNull(),
    canonicalName: text("canonical_name").notNull(),
    country: text("country"),
    logoUrl: text("logo_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    providerUniq: uniqueIndex("core_team_provider_uidx").on(
      t.providerName,
      t.providerTeamId
    ),
  })
);

export const coreTeamAlias = pgTable(
  "core_team_alias",
  {
    id: serial("id").primaryKey(),
    teamId: integer("team_id").notNull(),
    aliasNormalized: text("alias_normalized").notNull(),
    aliasRaw: text("alias_raw").notNull(),
    source: text("source").notNull(),
    /** 1 = approved for auto-resolve; 0 = fuzzy / needs review */
    approved: integer("approved").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    aliasTeamUniq: uniqueIndex("core_team_alias_norm_team_uidx").on(
      t.aliasNormalized,
      t.teamId
    ),
    aliasIdx: index("core_team_alias_norm_idx").on(t.aliasNormalized),
  })
);

export const coreFixture = pgTable(
  "core_fixture",
  {
    id: serial("id").primaryKey(),
    providerName: text("provider_name").notNull().default("api-sports"),
    providerFixtureId: integer("provider_fixture_id").notNull(),
    competitionId: integer("competition_id"),
    seasonId: integer("season_id"),
    homeTeamId: integer("home_team_id"),
    awayTeamId: integer("away_team_id"),
    homeTeamName: text("home_team_name").notNull(),
    awayTeamName: text("away_team_name").notNull(),
    kickoffUtc: timestamp("kickoff_utc", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    htHome: integer("ht_home"),
    htAway: integer("ht_away"),
    ftHome: integer("ft_home"),
    ftAway: integer("ft_away"),
    venue: text("venue"),
    round: text("round"),
    /** 1 = human-verified; backfill must not overwrite */
    manualVerified: integer("manual_verified").notNull().default(0),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    providerUniq: uniqueIndex("core_fixture_provider_uidx").on(
      t.providerName,
      t.providerFixtureId
    ),
    pairDateIdx: index("core_fixture_pair_date_idx").on(
      t.homeTeamName,
      t.awayTeamName,
      t.kickoffUtc
    ),
    statusDateIdx: index("core_fixture_status_date_idx").on(
      t.status,
      t.kickoffUtc
    ),
  })
);

export const coreFixtureStatistic = pgTable(
  "core_fixture_statistic",
  {
    id: serial("id").primaryKey(),
    fixtureId: integer("fixture_id").notNull(),
    teamId: integer("team_id"),
    /** home | away */
    side: text("side").notNull(),
    statKey: text("stat_key").notNull(),
    /** NULL means missing — never coerce to 0 */
    statValue: integer("stat_value"),
    manualVerified: integer("manual_verified").notNull().default(0),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  },
  (t) => ({
    fixtureSideKeyUniq: uniqueIndex("core_fixture_stat_fixture_side_key_uidx").on(
      t.fixtureId,
      t.side,
      t.statKey
    ),
    fixtureIdx: index("core_fixture_stat_fixture_idx").on(t.fixtureId),
  })
);

export const coreProviderIngestion = pgTable(
  "core_provider_ingestion",
  {
    id: serial("id").primaryKey(),
    providerName: text("provider_name").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    payloadHash: text("payload_hash"),
    endpoint: text("endpoint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    fpIdx: index("core_provider_ingestion_fp_idx").on(t.requestFingerprint),
  })
);

export const coreLegacyRecordMap = pgTable(
  "core_legacy_record_map",
  {
    id: serial("id").primaryKey(),
    legacySourceTable: text("legacy_source_table").notNull(),
    legacyPk: text("legacy_pk").notNull(),
    canonicalEntityType: text("canonical_entity_type").notNull(),
    canonicalEntityId: integer("canonical_entity_id").notNull(),
    verified: integer("verified").notNull().default(1),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    legacyUniq: uniqueIndex("core_legacy_record_map_uidx").on(
      t.legacySourceTable,
      t.legacyPk
    ),
  })
);

export const corePredictionRun = pgTable("core_prediction_run", {
  id: serial("id").primaryKey(),
  runKey: text("run_key"),
  modelVersion: text("model_version"),
  inputSnapshotHash: text("input_snapshot_hash"),
  metaJson: text("meta_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const coreMarketProbability = pgTable(
  "core_market_probability",
  {
    id: serial("id").primaryKey(),
    predictionRunId: integer("prediction_run_id"),
    fixtureId: integer("fixture_id"),
    marketKey: text("market_key").notNull(),
    selectionKey: text("selection_key").notNull(),
    probability: real("probability"),
    traceJson: text("trace_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    runIdx: index("core_market_probability_run_idx").on(t.predictionRunId),
    fixtureIdx: index("core_market_probability_fixture_idx").on(t.fixtureId),
  })
);

export const coreResultTrace = pgTable(
  "core_result_trace",
  {
    id: serial("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    matchId: text("match_id").notNull(),
    homeTeamName: text("home_team_name").notNull(),
    awayTeamName: text("away_team_name").notNull(),
    matchDate: text("match_date"),
    /**
     * pending | matched | filled | ambiguous | unresolved | not_final
     */
    status: text("status").notNull(),
    providerFixtureId: integer("provider_fixture_id"),
    coreFixtureId: integer("core_fixture_id"),
    evidenceJson: text("evidence_json"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    batchMatchUniq: uniqueIndex("core_result_trace_batch_match_uidx").on(
      t.batchId,
      t.matchId
    ),
    statusIdx: index("core_result_trace_status_idx").on(t.status),
  })
);

/** Rich settlement rows from Saved Batches (FT + HT + corners + goal timings). */
export const predictionLogSettlement = pgTable(
  "prediction_log_settlement",
  {
    id: serial("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    matchId: text("match_id").notNull(),
    league: text("league"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    matchDate: text("match_date"),
    ftHome: integer("ft_home").notNull(),
    ftAway: integer("ft_away").notNull(),
    htHome: integer("ht_home").notNull(),
    htAway: integer("ht_away").notNull(),
    matchHtTotal: integer("match_ht_total").notNull(),
    match2hTotal: integer("match_2h_total").notNull(),
    cornersHome: integer("corners_home").notNull(),
    cornersAway: integer("corners_away").notNull(),
    goalTimingJson: text("goal_timing_json"),
    providerFixtureId: integer("provider_fixture_id"),
    coreFixtureId: integer("core_fixture_id"),
    source: text("source").notNull().default("prediction_log_batch"),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    batchMatchUniq: uniqueIndex("prediction_log_settlement_batch_match_uidx").on(
      t.batchId,
      t.matchId
    ),
    batchIdx: index("prediction_log_settlement_batch_idx").on(t.batchId),
    coreFixtureIdx: index("prediction_log_settlement_core_fixture_idx").on(
      t.coreFixtureId
    ),
  })
);

/** Graded weekend-pick outcomes for AI Learner (source for loss-recovery rules). */
export const aiLearnerPickOutcomes = pgTable(
  "ai_learner_pick_outcomes",
  {
    id: serial("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    matchId: text("match_id").notNull(),
    providerFixtureId: integer("provider_fixture_id"),
    weekendSurface: text("weekend_surface").notNull(),
    league: text("league"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    matchDate: text("match_date"),
    marketKey: text("market_key").notNull(),
    prediction: text("prediction").notNull(),
    line: real("line"),
    confidence: integer("confidence"),
    result: text("result").notNull(),
    actualValue: text("actual_value"),
    lossReason: text("loss_reason"),
    ftHome: integer("ft_home"),
    ftAway: integer("ft_away"),
    htHome: integer("ht_home"),
    htAway: integer("ht_away"),
    cornersHome: integer("corners_home"),
    cornersAway: integer("corners_away"),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    batchMatchMarketUniq: uniqueIndex("ai_learner_pick_outcomes_batch_match_market_uidx").on(
      t.batchId,
      t.matchId,
      t.marketKey
    ),
    batchIdx: index("ai_learner_pick_outcomes_batch_idx").on(t.batchId),
    leagueIdx: index("ai_learner_pick_outcomes_league_idx").on(t.league),
    resultIdx: index("ai_learner_pick_outcomes_result_idx").on(t.result),
  })
);

/** Aggregated loss-recovery rules from weekend pick history. */
export const aiLearnerMarketRules = pgTable(
  "ai_learner_market_rules",
  {
    id: serial("id").primaryKey(),
    league: text("league").notNull(),
    lostMarket: text("lost_market").notNull(),
    lostPrediction: text("lost_prediction").notNull(),
    lostLine: real("lost_line"),
    winMarket: text("win_market").notNull(),
    winPrediction: text("win_prediction").notNull(),
    winLine: real("win_line"),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    sample: integer("sample").notNull().default(0),
    winRate: integer("win_rate"),
    ruleText: text("rule_text").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    ruleUniq: uniqueIndex("ai_learner_market_rules_rule_uidx").on(
      t.league,
      t.lostMarket,
      t.lostPrediction,
      t.lostLine,
      t.winMarket,
      t.winPrediction,
      t.winLine
    ),
    leagueIdx: index("ai_learner_market_rules_league_idx").on(t.league),
    lostMarketIdx: index("ai_learner_market_rules_lost_market_idx").on(t.lostMarket),
  })
);

/** Postgres mirror of LearnerStatsStore JSON for AI Learner recommendations. */
export const aiLearnerStatsSnapshot = pgTable(
  "ai_learner_stats_snapshot",
  {
    id: text("id").primaryKey(),
    statsJson: text("stats_json").notNull(),
    totalScoredPicks: integer("total_scored_picks").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  }
);

export type AiLearnerPickOutcome = typeof aiLearnerPickOutcomes.$inferSelect;
export type NewAiLearnerPickOutcome = typeof aiLearnerPickOutcomes.$inferInsert;
export type AiLearnerMarketRule = typeof aiLearnerMarketRules.$inferSelect;
export type NewAiLearnerMarketRule = typeof aiLearnerMarketRules.$inferInsert;
export type AiLearnerStatsSnapshot = typeof aiLearnerStatsSnapshot.$inferSelect;

/** Aggregated team/market win rates from weekend per-market result tables. */
export const aiLearnerMarketReliability = pgTable(
  "ai_learner_market_reliability",
  {
    id: serial("id").primaryKey(),
    team: text("team").notNull(),
    league: text("league").notNull(),
    marketFamily: text("market_family").notNull(),
    selection: text("selection").notNull(),
    line: real("line"),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    sample: integer("sample").notNull().default(0),
    winRate: integer("win_rate"),
    ruleText: text("rule_text").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("ai_learner_market_reliability_uidx").on(
      t.team,
      t.league,
      t.marketFamily,
      t.selection,
      t.line
    ),
    teamIdx: index("ai_learner_market_reliability_team_idx").on(t.team),
    leagueIdx: index("ai_learner_market_reliability_league_idx").on(t.league),
    familyIdx: index("ai_learner_market_reliability_family_idx").on(t.marketFamily),
  })
);

export type AiLearnerMarketReliability = typeof aiLearnerMarketReliability.$inferSelect;
export type NewAiLearnerMarketReliability = typeof aiLearnerMarketReliability.$inferInsert;

/** Shared weekend market result row shape (family A — win / result markets). */
export const weekendMarketWinResults = pgTable(
  "weekend_market_win_results",
  {
    id: serial("id").primaryKey(),
    weekendBatchId: text("weekend_batch_id").notNull(),
    matchId: text("match_id").notNull(),
    providerFixtureId: integer("provider_fixture_id"),
    league: text("league"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    matchDate: text("match_date"),
    selection: text("selection").notNull(),
    line: real("line"),
    actualValue: text("actual_value"),
    result: text("result").notNull(),
    wasWeekendPick: integer("was_weekend_pick").notNull().default(0),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("weekend_market_win_results_uidx").on(
      t.weekendBatchId,
      t.matchId,
      t.selection,
      t.line
    ),
    batchIdx: index("weekend_market_win_results_batch_idx").on(t.weekendBatchId),
    leagueIdx: index("weekend_market_win_results_league_idx").on(t.league),
  })
);

export const weekendMarketHalfGoalResults = pgTable(
  "weekend_market_half_goal_results",
  {
    id: serial("id").primaryKey(),
    weekendBatchId: text("weekend_batch_id").notNull(),
    matchId: text("match_id").notNull(),
    providerFixtureId: integer("provider_fixture_id"),
    league: text("league"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    matchDate: text("match_date"),
    selection: text("selection").notNull(),
    line: real("line"),
    actualValue: text("actual_value"),
    result: text("result").notNull(),
    wasWeekendPick: integer("was_weekend_pick").notNull().default(0),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("weekend_market_half_goal_results_uidx").on(
      t.weekendBatchId,
      t.matchId,
      t.selection,
      t.line
    ),
    batchIdx: index("weekend_market_half_goal_results_batch_idx").on(
      t.weekendBatchId
    ),
  })
);

export const weekendMarketCornerResults = pgTable(
  "weekend_market_corner_results",
  {
    id: serial("id").primaryKey(),
    weekendBatchId: text("weekend_batch_id").notNull(),
    matchId: text("match_id").notNull(),
    providerFixtureId: integer("provider_fixture_id"),
    league: text("league"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    matchDate: text("match_date"),
    selection: text("selection").notNull(),
    line: real("line"),
    actualValue: text("actual_value"),
    result: text("result").notNull(),
    wasWeekendPick: integer("was_weekend_pick").notNull().default(0),
    corners1hHome: integer("corners_1h_home"),
    corners1hAway: integer("corners_1h_away"),
    corners2hHome: integer("corners_2h_home"),
    corners2hAway: integer("corners_2h_away"),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("weekend_market_corner_results_uidx").on(
      t.weekendBatchId,
      t.matchId,
      t.selection,
      t.line
    ),
    batchIdx: index("weekend_market_corner_results_batch_idx").on(t.weekendBatchId),
  })
);

export const weekendMarketComboResults = pgTable(
  "weekend_market_combo_results",
  {
    id: serial("id").primaryKey(),
    weekendBatchId: text("weekend_batch_id").notNull(),
    matchId: text("match_id").notNull(),
    providerFixtureId: integer("provider_fixture_id"),
    league: text("league"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    matchDate: text("match_date"),
    selection: text("selection").notNull(),
    line: real("line"),
    actualValue: text("actual_value"),
    result: text("result").notNull(),
    wasWeekendPick: integer("was_weekend_pick").notNull().default(0),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("weekend_market_combo_results_uidx").on(
      t.weekendBatchId,
      t.matchId,
      t.selection,
      t.line
    ),
    batchIdx: index("weekend_market_combo_results_batch_idx").on(t.weekendBatchId),
  })
);

export const weekendMarketBttsHalvesResults = pgTable(
  "weekend_market_btts_halves_results",
  {
    id: serial("id").primaryKey(),
    weekendBatchId: text("weekend_batch_id").notNull(),
    matchId: text("match_id").notNull(),
    providerFixtureId: integer("provider_fixture_id"),
    league: text("league"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    matchDate: text("match_date"),
    selection: text("selection").notNull(),
    line: real("line"),
    actualValue: text("actual_value"),
    result: text("result").notNull(),
    wasWeekendPick: integer("was_weekend_pick").notNull().default(0),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("weekend_market_btts_halves_results_uidx").on(
      t.weekendBatchId,
      t.matchId,
      t.selection,
      t.line
    ),
    batchIdx: index("weekend_market_btts_halves_results_batch_idx").on(
      t.weekendBatchId
    ),
  })
);

export const weekendMarketDrawHalfResults = pgTable(
  "weekend_market_draw_half_results",
  {
    id: serial("id").primaryKey(),
    weekendBatchId: text("weekend_batch_id").notNull(),
    matchId: text("match_id").notNull(),
    providerFixtureId: integer("provider_fixture_id"),
    league: text("league"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    matchDate: text("match_date"),
    selection: text("selection").notNull(),
    line: real("line"),
    actualValue: text("actual_value"),
    result: text("result").notNull(),
    wasWeekendPick: integer("was_weekend_pick").notNull().default(0),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("weekend_market_draw_half_results_uidx").on(
      t.weekendBatchId,
      t.matchId,
      t.selection,
      t.line
    ),
    batchIdx: index("weekend_market_draw_half_results_batch_idx").on(
      t.weekendBatchId
    ),
  })
);

export const weekendMarketTotalGoalsResults = pgTable(
  "weekend_market_total_goals_results",
  {
    id: serial("id").primaryKey(),
    weekendBatchId: text("weekend_batch_id").notNull(),
    matchId: text("match_id").notNull(),
    providerFixtureId: integer("provider_fixture_id"),
    league: text("league"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    matchDate: text("match_date"),
    selection: text("selection").notNull(),
    line: real("line"),
    actualValue: text("actual_value"),
    result: text("result").notNull(),
    wasWeekendPick: integer("was_weekend_pick").notNull().default(0),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("weekend_market_total_goals_results_uidx").on(
      t.weekendBatchId,
      t.matchId,
      t.selection,
      t.line
    ),
    batchIdx: index("weekend_market_total_goals_results_batch_idx").on(
      t.weekendBatchId
    ),
  })
);

export const weekendMarketStatsResults = pgTable(
  "weekend_market_stats_results",
  {
    id: serial("id").primaryKey(),
    weekendBatchId: text("weekend_batch_id").notNull(),
    matchId: text("match_id").notNull(),
    providerFixtureId: integer("provider_fixture_id"),
    league: text("league"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    matchDate: text("match_date"),
    selection: text("selection").notNull(),
    line: real("line"),
    actualValue: text("actual_value"),
    result: text("result").notNull(),
    wasWeekendPick: integer("was_weekend_pick").notNull().default(0),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("weekend_market_stats_results_uidx").on(
      t.weekendBatchId,
      t.matchId,
      t.selection,
      t.line
    ),
    batchIdx: index("weekend_market_stats_results_batch_idx").on(t.weekendBatchId),
  })
);

export type WeekendMarketWinResult = typeof weekendMarketWinResults.$inferSelect;
export type NewWeekendMarketWinResult = typeof weekendMarketWinResults.$inferInsert;

export const coreCoverageAudit = pgTable(
  "core_coverage_audit",
  {
    id: serial("id").primaryKey(),
    competitionId: integer("competition_id").notNull(),
    seasonId: integer("season_id").notNull(),
    expectedFixtures: integer("expected_fixtures"),
    importedFixtures: integer("imported_fixtures"),
    withHt: integer("with_ht"),
    withStats: integer("with_stats"),
    withCorners: integer("with_corners"),
    completeness: text("completeness"),
    inventoryPass: integer("inventory_pass").notNull().default(0),
    providerHole: integer("provider_hole").notNull().default(0),
    providerHoleReason: text("provider_hole_reason"),
    auditedAt: timestamp("audited_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    compSeasonUniq: uniqueIndex("core_coverage_audit_comp_season_uidx").on(
      t.competitionId,
      t.seasonId
    ),
  })
);

export const auditDataChangeLog = pgTable(
  "audit_data_change_log",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id"),
    action: text("action").notNull(),
    diffJson: text("diff_json"),
    actor: text("actor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    entityIdx: index("audit_data_change_log_entity_idx").on(
      t.entityType,
      t.entityId
    ),
    createdIdx: index("audit_data_change_log_created_idx").on(t.createdAt),
  })
);

/** Append-only blended analysis run audit (additive). */
export const coreAnalysisRun = pgTable(
  "core_analysis_run",
  {
    id: serial("id").primaryKey(),
    pageId: text("page_id").notNull(),
    mode: text("mode").notNull(),
    configuredApiWeight: real("configured_api_weight").notNull(),
    configuredSystemWeight: real("configured_system_weight").notNull(),
    effectiveApiWeight: real("effective_api_weight").notNull(),
    effectiveSystemWeight: real("effective_system_weight").notNull(),
    apiRecordCount: integer("api_record_count").notNull().default(0),
    systemRecordCount: integer("system_record_count").notNull().default(0),
    apiDateFrom: text("api_date_from"),
    apiDateTo: text("api_date_to"),
    systemDateFrom: text("system_date_from"),
    systemDateTo: text("system_date_to"),
    calculationVersion: text("calculation_version").notNull(),
    status: text("status").notNull(),
    fallbackReason: text("fallback_reason"),
    warningsJson: text("warnings_json"),
    metaJson: text("meta_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    pageIdx: index("core_analysis_run_page_idx").on(t.pageId),
    createdIdx: index("core_analysis_run_created_idx").on(t.createdAt),
  })
);

export type CoreCompetition = typeof coreCompetition.$inferSelect;
export type CoreSeason = typeof coreSeason.$inferSelect;
export type CoreTeam = typeof coreTeam.$inferSelect;
export type CoreTeamAlias = typeof coreTeamAlias.$inferSelect;
export type CoreFixture = typeof coreFixture.$inferSelect;
export type CoreFixtureStatistic = typeof coreFixtureStatistic.$inferSelect;
export type CoreLegacyRecordMap = typeof coreLegacyRecordMap.$inferSelect;
export type CoreResultTrace = typeof coreResultTrace.$inferSelect;
export type PredictionLogSettlement = typeof predictionLogSettlement.$inferSelect;
export type NewPredictionLogSettlement = typeof predictionLogSettlement.$inferInsert;
export type CoreCoverageAudit = typeof coreCoverageAudit.$inferSelect;
export type AuditDataChangeLog = typeof auditDataChangeLog.$inferSelect;
export type CoreAnalysisRun = typeof coreAnalysisRun.$inferSelect;

/** MSAM immutable advisory run (additive). */
export const marketAdvisoryRuns = pgTable(
  "market_advisory_runs",
  {
    id: serial("id").primaryKey(),
    advisoryRunId: text("advisory_run_id").notNull(),
    fixtureId: integer("fixture_id").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    predictionCutoffAt: timestamp("prediction_cutoff_at", {
      withTimezone: true,
    }).notNull(),
    canonicalProbabilitySnapshotId: text("canonical_probability_snapshot_id"),
    existingSelectorSnapshotId: text("existing_selector_snapshot_id"),
    msamModelVersion: text("msam_model_version").notNull(),
    collaborationPolicyVersion: text("collaboration_policy_version").notNull(),
    dataPolicyVersion: text("data_policy_version").notNull(),
    status: text("status").notNull(),
    inputLineageHash: text("input_lineage_hash").notNull(),
    metaJson: text("meta_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    runIdUniq: uniqueIndex("market_advisory_runs_run_id_uidx").on(
      t.advisoryRunId
    ),
    fixtureCutoffUniq: uniqueIndex("market_advisory_runs_fixture_cutoff_uidx").on(
      t.fixtureId,
      t.predictionCutoffAt,
      t.msamModelVersion,
      t.collaborationPolicyVersion
    ),
    fixtureIdx: index("market_advisory_runs_fixture_idx").on(t.fixtureId),
  })
);

export const marketAdvisoryCandidates = pgTable(
  "market_advisory_candidates",
  {
    id: serial("id").primaryKey(),
    advisoryRunId: text("advisory_run_id").notNull(),
    marketCode: text("market_code").notNull(),
    marketFamily: text("market_family").notNull(),
    conflictGroup: text("conflict_group").notNull(),
    marketDefinitionHash: text("market_definition_hash").notNull(),
    marketDefinitionJson: text("market_definition_json"),
    rawProbability: real("raw_probability"),
    calibratedProbability: real("calibrated_probability"),
    probabilityLower: real("probability_lower"),
    probabilityUpper: real("probability_upper"),
    eligible: integer("eligible").notNull().default(0),
    ineligibilityReasonCodes: text("ineligibility_reason_codes"),
    ops: real("ops"),
    cqs: real("cqs"),
    ecs: real("ecs"),
    sss: real("sss"),
    iss: real("iss"),
    dis: real("dis"),
    msamScore: real("msam_score"),
    existingNormalizedScore: real("existing_normalized_score"),
    msamNormalizedScore: real("msam_normalized_score"),
    finalAdvisoryScore: real("final_advisory_score"),
    selectionRole: text("selection_role"),
    primaryRank: integer("primary_rank"),
    agreementStatus: text("agreement_status"),
    explanationSnapshotJson: text("explanation_snapshot_json"),
    diagnosticSnapshotJson: text("diagnostic_snapshot_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    runMarketUniq: uniqueIndex("market_advisory_candidates_run_market_uidx").on(
      t.advisoryRunId,
      t.marketCode,
      t.marketDefinitionHash
    ),
    runIdx: index("market_advisory_candidates_run_idx").on(t.advisoryRunId),
  })
);

export const marketAdvisorySourceCoverage = pgTable(
  "market_advisory_source_coverage",
  {
    id: serial("id").primaryKey(),
    advisoryRunId: text("advisory_run_id").notNull(),
    marketCode: text("market_code"),
    featureFamily: text("feature_family"),
    targetApiWeight: real("target_api_weight"),
    targetSystemWeight: real("target_system_weight"),
    effectiveApiWeight: real("effective_api_weight"),
    effectiveSystemWeight: real("effective_system_weight"),
    apiRecordCount: integer("api_record_count"),
    systemRecordCount: integer("system_record_count"),
    effectiveSampleSize: real("effective_sample_size"),
    completenessJson: text("completeness_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    runIdx: index("market_advisory_source_coverage_run_idx").on(
      t.advisoryRunId
    ),
  })
);

export const marketCalibrationMetrics = pgTable(
  "market_calibration_metrics",
  {
    id: serial("id").primaryKey(),
    marketCode: text("market_code"),
    marketFamily: text("market_family"),
    competitionScope: text("competition_scope"),
    probabilityBin: text("probability_bin"),
    timeWindow: text("time_window"),
    modelVersion: text("model_version"),
    sampleSize: integer("sample_size"),
    effectiveSampleSize: real("effective_sample_size"),
    brierScore: real("brier_score"),
    logLoss: real("log_loss"),
    reliabilityJson: text("reliability_json"),
    baselineComparisonJson: text("baseline_comparison_json"),
    validationCutoff: timestamp("validation_cutoff", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    scopeIdx: index("market_calibration_metrics_scope_idx").on(
      t.marketFamily,
      t.competitionScope
    ),
  })
);

export const marketAdvisoryConfigVersions = pgTable(
  "market_advisory_config_versions",
  {
    id: serial("id").primaryKey(),
    versionKey: text("version_key").notNull(),
    configJson: text("config_json").notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    versionUniq: uniqueIndex("market_advisory_config_versions_key_uidx").on(
      t.versionKey
    ),
  })
);

export const marketAdvisoryAuditEvents = pgTable(
  "market_advisory_audit_events",
  {
    id: serial("id").primaryKey(),
    advisoryRunId: text("advisory_run_id"),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    runIdx: index("market_advisory_audit_events_run_idx").on(t.advisoryRunId),
    typeIdx: index("market_advisory_audit_events_type_idx").on(t.eventType),
  })
);

export type MarketAdvisoryRun = typeof marketAdvisoryRuns.$inferSelect;
export type MarketAdvisoryCandidate = typeof marketAdvisoryCandidates.$inferSelect;
