import { neon } from "@neondatabase/serverless";

let initialized = false;

export async function ensureSchema(): Promise<void> {
  const url =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL;
  if (!url) return;

  const sql = neon(url);

  // Always ensure live_sync_meta exists (added after initial live_* rollout).
  await sql`
    CREATE TABLE IF NOT EXISTS live_sync_meta (
      id integer PRIMARY KEY DEFAULT 1,
      last_sync_at timestamptz,
      last_sync_status text,
      last_sync_reason text,
      last_from date,
      last_to date,
      last_fetched integer,
      last_upserted integer
    )
  `;

  if (initialized) return;

  await sql`
    CREATE TABLE IF NOT EXISTS matches (
      id serial PRIMARY KEY,
      match_date date,
      home_team text NOT NULL,
      away_team text NOT NULL,
      fthg integer NOT NULL,
      ftag integer NOT NULL,
      hthg integer,
      htag integer,
      hs integer,
      away_shots integer,
      hst integer,
      ast integer,
      ho integer,
      ao integer,
      hc integer,
      ac integer,
      created_at timestamp DEFAULT now() NOT NULL
    )
  `;

  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS hthg integer`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS htag integer`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS hc integer`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS ac integer`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS hti integer`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS ati integer`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS b365_home real`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS b365_draw real`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS b365_away real`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS b365_over25 real`;
  await sql`ALTER TABLE matches ADD COLUMN IF NOT EXISTS b365_under25 real`;

  await sql`DROP TABLE IF EXISTS user_predictions CASCADE`;
  await sql`DROP TABLE IF EXISTS user_prediction_lists CASCADE`;
  await sql`DROP TABLE IF EXISTS predictions CASCADE`;

  await sql`
    CREATE TABLE IF NOT EXISTS live_leagues (
      league_id integer PRIMARY KEY,
      name text NOT NULL,
      country text,
      season integer NOT NULL,
      logo_url text
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS live_fixtures (
      fixture_id integer PRIMARY KEY,
      league_id integer NOT NULL,
      season integer NOT NULL,
      home_team text NOT NULL,
      away_team text NOT NULL,
      home_id integer,
      away_id integer,
      kickoff_utc timestamptz NOT NULL,
      venue text,
      status text NOT NULL,
      status_minute integer,
      home_goals integer,
      away_goals integer,
      last_synced_utc timestamptz NOT NULL,
      settled_emitted_at timestamptz
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS live_events (
      id serial PRIMARY KEY,
      fixture_id integer NOT NULL,
      minute integer,
      type text,
      team text,
      player text
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS live_fixtures_status_idx ON live_fixtures (status)`;
  await sql`CREATE INDEX IF NOT EXISTS live_fixtures_kickoff_idx ON live_fixtures (kickoff_utc)`;
  await sql`CREATE INDEX IF NOT EXISTS live_fixtures_league_season_idx ON live_fixtures (league_id, season)`;
  await sql`CREATE INDEX IF NOT EXISTS live_events_fixture_idx ON live_events (fixture_id)`;

  initialized = true;
}
