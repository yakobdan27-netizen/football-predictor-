import {
  pgTable,
  serial,
  text,
  integer,
  date,
  timestamp,
  real,
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
