import {
  pgTable,
  serial,
  text,
  integer,
  date,
  timestamp,
  real,
  index,
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

export type LiveLeague = typeof liveLeagues.$inferSelect;
export type NewLiveLeague = typeof liveLeagues.$inferInsert;
export type LiveFixture = typeof liveFixtures.$inferSelect;
export type NewLiveFixture = typeof liveFixtures.$inferInsert;
export type LiveEvent = typeof liveEvents.$inferSelect;
export type NewLiveEvent = typeof liveEvents.$inferInsert;
