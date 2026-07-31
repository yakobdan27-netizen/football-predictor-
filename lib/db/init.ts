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

  // Always ensure match_stats exists (canonical Stats API persistence).
  await sql`
    CREATE TABLE IF NOT EXISTS match_stats (
      fixture_id integer PRIMARY KEY,
      stats_api_match_id text,
      league_id integer,
      season integer,
      home_team text NOT NULL,
      away_team text NOT NULL,
      kickoff_utc timestamptz,
      status text,
      home_goals integer,
      away_goals integer,
      home_corners integer,
      away_corners integer,
      home_shots integer,
      away_shots integer,
      home_possession integer,
      away_possession integer,
      source_conflicts text,
      provider text NOT NULL DEFAULT 'thestatsapi',
      fetched_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  // Expanded overview stats (nullable — additive / safe for other backends)
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_shots_on_target integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_shots_on_target integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_xg real`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_xg real`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_big_chances integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_big_chances integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_gk_saves integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_gk_saves integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_fouls integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_fouls integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_yellow_cards integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_yellow_cards integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_red_cards integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_red_cards integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_passes integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_passes integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_accurate_passes integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_accurate_passes integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_tackles integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_tackles integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_free_kicks integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_free_kicks integer`;
  await sql`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS raw_json text`;
  await sql`CREATE INDEX IF NOT EXISTS match_stats_league_season_idx ON match_stats (league_id, season)`;
  await sql`CREATE INDEX IF NOT EXISTS match_stats_kickoff_idx ON match_stats (kickoff_utc)`;
  await sql`CREATE INDEX IF NOT EXISTS match_stats_stats_api_id_idx ON match_stats (stats_api_match_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS stats_backfill_meta (
      id integer PRIMARY KEY DEFAULT 1,
      phase text NOT NULL DEFAULT 'inventory',
      cell_index integer NOT NULL DEFAULT 0,
      league_id integer,
      season integer,
      last_error text,
      last_summary text,
      updated_at timestamptz NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS team_season_stats (
      team_name text NOT NULL,
      league_id integer NOT NULL,
      season integer NOT NULL,
      af_team_id integer,
      matches integer NOT NULL DEFAULT 0,
      home_matches integer NOT NULL DEFAULT 0,
      away_matches integer NOT NULL DEFAULT 0,
      avg_goals_for real,
      avg_goals_against real,
      avg_xg_for real,
      avg_xg_against real,
      avg_shots_for real,
      avg_shots_against real,
      avg_shots_on_target_for real,
      avg_shots_on_target_against real,
      avg_corners_for real,
      avg_corners_against real,
      avg_possession real,
      avg_fouls_for real,
      avg_yellow_cards_for real,
      avg_red_cards_for real,
      avg_passes_for real,
      avg_tackles_for real,
      home_avg_goals_for real,
      home_avg_corners_for real,
      home_avg_shots_on_target_for real,
      away_avg_goals_for real,
      away_avg_corners_for real,
      away_avg_shots_on_target_for real,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (team_name, league_id, season)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS team_season_stats_league_season_idx ON team_season_stats (league_id, season)`;

  await sql`
    CREATE TABLE IF NOT EXISTS bet_events (
      id serial PRIMARY KEY,
      api_fixture_id integer NOT NULL UNIQUE,
      league_id integer NOT NULL,
      home text NOT NULL,
      away text NOT NULL,
      kickoff_utc timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'NS',
      minute integer,
      home_score integer,
      away_score integer,
      feed_type text NOT NULL DEFAULT 'PRE',
      last_synced_at timestamptz NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS bet_events_kickoff_idx ON bet_events (kickoff_utc)`;
  await sql`CREATE INDEX IF NOT EXISTS bet_events_status_idx ON bet_events (status)`;
  await sql`CREATE INDEX IF NOT EXISTS bet_events_feed_idx ON bet_events (feed_type)`;

  await sql`
    CREATE TABLE IF NOT EXISTS bet_markets (
      id serial PRIMARY KEY,
      bet_event_id integer NOT NULL,
      market_type text NOT NULL,
      selection_label text NOT NULL,
      odd real,
      is_available integer NOT NULL DEFAULT 1,
      source text NOT NULL DEFAULT 'MANUAL',
      updated_at timestamptz NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS bet_markets_event_idx ON bet_markets (bet_event_id)`;
  await sql`CREATE INDEX IF NOT EXISTS bet_markets_type_idx ON bet_markets (bet_event_id, market_type, selection_label)`;

  await sql`
    CREATE TABLE IF NOT EXISTS bet_slips (
      id serial PRIMARY KEY,
      created_at timestamptz NOT NULL,
      slip_type text NOT NULL DEFAULT 'SINGLE',
      stake real NOT NULL,
      total_odd real NOT NULL,
      potential_return real NOT NULL,
      status text NOT NULL DEFAULT 'OPEN',
      settled_at timestamptz,
      note text
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS bet_slips_status_idx ON bet_slips (status)`;
  await sql`CREATE INDEX IF NOT EXISTS bet_slips_created_idx ON bet_slips (created_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS bet_selections (
      id serial PRIMARY KEY,
      bet_slip_id integer NOT NULL,
      bet_event_id integer NOT NULL,
      market_id integer NOT NULL,
      chosen_label text NOT NULL,
      chosen_odd real NOT NULL,
      result text NOT NULL DEFAULT 'PENDING',
      settled_at timestamptz
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS bet_selections_slip_idx ON bet_selections (bet_slip_id)`;
  await sql`CREATE INDEX IF NOT EXISTS bet_selections_event_idx ON bet_selections (bet_event_id)`;

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

  // Secondary provider match id (The Stats API `mt_…`; was BeSoccer numeric id)
  await sql`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS besoccer_match_id text`;
  // If an older integer column exists, widen to text (safe no-op when already text)
  await sql`
    DO $$ BEGIN
      ALTER TABLE live_fixtures
        ALTER COLUMN besoccer_match_id TYPE text
        USING besoccer_match_id::text;
    EXCEPTION WHEN others THEN NULL;
    END $$
  `;
  await sql`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS home_corners integer`;
  await sql`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS away_corners integer`;
  await sql`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS home_shots integer`;
  await sql`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS away_shots integer`;
  await sql`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS home_possession integer`;
  await sql`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS away_possession integer`;
  await sql`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS source_conflicts text`;

  initialized = true;
}
