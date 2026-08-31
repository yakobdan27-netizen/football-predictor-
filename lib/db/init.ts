import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/** Bump when additive DDL changes so cold starts can skip full bootstrap. */
const SCHEMA_BOOTSTRAP_VERSION = 7;

let initialized = false;
let ensureSchemaPromise: Promise<void> | null = null;

function isDuplicateRelationError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string }).code;
  return (
    code === "23505" ||
    code === "42P07" ||
    /pg_class_relname_nsp_index|already exists|duplicate key value/i.test(msg)
  );
}

function agentLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string
): void {
  // #region agent log
  fetch("http://127.0.0.1:7484/ingest/38649fab-69bc-43fe-918c-13ca943dd3c2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "9c443b",
    },
    body: JSON.stringify({
      sessionId: "9c443b",
      location,
      message,
      data,
      hypothesisId,
      timestamp: Date.now(),
      runId: "pre-fix",
    }),
  }).catch(() => {});
  // #endregion
}

export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = runEnsureSchema().catch((e) => {
      ensureSchemaPromise = null;
      throw e;
    });
  }
  return ensureSchemaPromise;
}

async function runEnsureSchema(): Promise<void> {
  agentLog("lib/db/init.ts:entry", "ensureSchema start", {}, "H1");

  const url =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL;
  if (!url) return;

  const rawSql: NeonQueryFunction<false, false> = neon(url);

  async function ddl(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown> {
    try {
      return await rawSql(strings, ...values);
    } catch (e) {
      if (isDuplicateRelationError(e)) {
        agentLog(
          "lib/db/init.ts:ddl",
          "swallowed duplicate relation DDL race",
          {
            code: (e as { code?: string }).code,
            message: e instanceof Error ? e.message : String(e),
          },
          "H1"
        );
        return;
      }
      throw e;
    }
  }

  await ddl`
    CREATE TABLE IF NOT EXISTS app_schema_meta (
      id integer PRIMARY KEY DEFAULT 1,
      version integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const metaRows = await rawSql`
    SELECT version FROM app_schema_meta WHERE id = 1
  `;
  const currentVersion =
    (metaRows[0] as { version?: number } | undefined)?.version ?? 0;
  if (currentVersion >= SCHEMA_BOOTSTRAP_VERSION) {
    agentLog(
      "lib/db/init.ts:fastpath",
      "schema bootstrap skipped",
      { currentVersion, target: SCHEMA_BOOTSTRAP_VERSION },
      "H4"
    );
    initialized = true;
    return;
  }

  agentLog(
    "lib/db/init.ts:bootstrap",
    "running full schema bootstrap",
    { currentVersion, target: SCHEMA_BOOTSTRAP_VERSION },
    "H2"
  );

  // live_sync_meta (added after initial live_* rollout).
  await ddl`
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

  // match_stats (canonical Stats API persistence).
  await ddl`
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
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_shots_on_target integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_shots_on_target integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_xg real`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_xg real`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_big_chances integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_big_chances integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_gk_saves integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_gk_saves integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_fouls integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_fouls integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_yellow_cards integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_yellow_cards integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_red_cards integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_red_cards integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_passes integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_passes integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_accurate_passes integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_accurate_passes integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_tackles integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_tackles integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS home_free_kicks integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS away_free_kicks integer`;
  await ddl`ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS raw_json text`;
  await ddl`CREATE INDEX IF NOT EXISTS match_stats_league_season_idx ON match_stats (league_id, season)`;
  await ddl`CREATE INDEX IF NOT EXISTS match_stats_kickoff_idx ON match_stats (kickoff_utc)`;
  await ddl`CREATE INDEX IF NOT EXISTS match_stats_stats_api_id_idx ON match_stats (stats_api_match_id)`;

  await ddl`
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

  await ddl`
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
  await ddl`CREATE INDEX IF NOT EXISTS team_season_stats_league_season_idx ON team_season_stats (league_id, season)`;

  await ddl`
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
  await ddl`CREATE INDEX IF NOT EXISTS bet_events_kickoff_idx ON bet_events (kickoff_utc)`;
  await ddl`CREATE INDEX IF NOT EXISTS bet_events_status_idx ON bet_events (status)`;
  await ddl`CREATE INDEX IF NOT EXISTS bet_events_feed_idx ON bet_events (feed_type)`;

  await ddl`
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
  await ddl`CREATE INDEX IF NOT EXISTS bet_markets_event_idx ON bet_markets (bet_event_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS bet_markets_type_idx ON bet_markets (bet_event_id, market_type, selection_label)`;

  await ddl`
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
  await ddl`CREATE INDEX IF NOT EXISTS bet_slips_status_idx ON bet_slips (status)`;
  await ddl`CREATE INDEX IF NOT EXISTS bet_slips_created_idx ON bet_slips (created_at)`;

  await ddl`
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
  await ddl`CREATE INDEX IF NOT EXISTS bet_selections_slip_idx ON bet_selections (bet_slip_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS bet_selections_event_idx ON bet_selections (bet_event_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS ext_users (
      id serial PRIMARY KEY,
      phone text NOT NULL UNIQUE,
      display_name text,
      first_seen_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS ext_users_phone_idx ON ext_users (phone)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS ext_slips (
      id serial PRIMARY KEY,
      ext_user_id integer NOT NULL,
      created_at timestamptz NOT NULL,
      slip_type text NOT NULL DEFAULT 'MULTI',
      stake real NOT NULL,
      total_odd real NOT NULL,
      potential_return real NOT NULL,
      note text,
      status text NOT NULL DEFAULT 'SUBMITTED',
      settled_at timestamptz
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS ext_slips_user_idx ON ext_slips (ext_user_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS ext_slips_status_idx ON ext_slips (status)`;
  await ddl`CREATE INDEX IF NOT EXISTS ext_slips_created_idx ON ext_slips (created_at)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS ext_selections (
      id serial PRIMARY KEY,
      ext_slip_id integer NOT NULL,
      bet_event_id integer,
      market_id integer,
      event_label text NOT NULL,
      market_label text NOT NULL,
      chosen_label text NOT NULL,
      chosen_odd real NOT NULL,
      result text NOT NULL DEFAULT 'PENDING',
      settled_at timestamptz
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS ext_selections_slip_idx ON ext_selections (ext_slip_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS ext_selections_event_idx ON ext_selections (bet_event_id)`;

  // Historical AF seed tables (isolated from live_*/bet_*/match_stats)
  await ddl`
    CREATE TABLE IF NOT EXISTS hist_fixtures (
      fixture_id integer PRIMARY KEY,
      league_id integer NOT NULL,
      season integer NOT NULL,
      comp_type text NOT NULL DEFAULT 'league',
      round text,
      date_utc timestamptz NOT NULL,
      home_id integer,
      away_id integer,
      home_team text NOT NULL,
      away_team text NOT NULL,
      venue text,
      ht_home integer,
      ht_away integer,
      ft_home integer,
      ft_away integer,
      status text NOT NULL,
      data_completeness text NOT NULL DEFAULT 'core-only',
      imported_at timestamptz NOT NULL
    )
  `;
  await ddl`ALTER TABLE hist_fixtures ADD COLUMN IF NOT EXISTS comp_type text NOT NULL DEFAULT 'league'`;
  await ddl`CREATE INDEX IF NOT EXISTS hist_fixtures_league_season_idx ON hist_fixtures (league_id, season)`;
  await ddl`CREATE INDEX IF NOT EXISTS hist_fixtures_date_idx ON hist_fixtures (date_utc)`;
  await ddl`CREATE INDEX IF NOT EXISTS hist_fixtures_comp_type_idx ON hist_fixtures (comp_type)`;
  await ddl`CREATE INDEX IF NOT EXISTS hist_fixtures_home_id_idx ON hist_fixtures (home_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS hist_fixtures_away_id_idx ON hist_fixtures (away_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS hist_fixtures_status_idx ON hist_fixtures (status)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS hist_goals (
      id serial PRIMARY KEY,
      fixture_id integer NOT NULL,
      team_id integer,
      minute integer,
      extra_minute integer,
      half text NOT NULL,
      player text,
      type text
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS hist_goals_fixture_idx ON hist_goals (fixture_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS hist_stats (
      id serial PRIMARY KEY,
      fixture_id integer NOT NULL,
      team_id integer NOT NULL,
      shots integer,
      sot integer,
      possession integer,
      corners integer,
      ht_corners integer,
      yellow integer,
      red integer,
      fouls integer,
      offsides integer
    )
  `;
  await ddl`ALTER TABLE hist_stats ADD COLUMN IF NOT EXISTS ht_corners integer`;
  await ddl`CREATE INDEX IF NOT EXISTS hist_stats_fixture_team_idx ON hist_stats (fixture_id, team_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS hist_lineups (
      id serial PRIMARY KEY,
      fixture_id integer NOT NULL,
      team_id integer NOT NULL,
      formation text
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS hist_lineups_fixture_team_idx ON hist_lineups (fixture_id, team_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS hist_teams (
      team_id integer PRIMARY KEY,
      name text NOT NULL,
      logo text,
      country text,
      first_seen_season integer
    )
  `;

  await ddl`
    CREATE TABLE IF NOT EXISTS hist_jobs (
      league_id integer NOT NULL,
      season integer NOT NULL,
      league_name text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      cursor_fixture_id integer,
      fixtures_total integer NOT NULL DEFAULT 0,
      fixtures_imported integer NOT NULL DEFAULT 0,
      goals_imported integer NOT NULL DEFAULT 0,
      stats_imported integer NOT NULL DEFAULT 0,
      skip_reason text,
      started_at timestamptz,
      finished_at timestamptz,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (league_id, season)
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS hist_jobs_status_idx ON hist_jobs (status)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS hist_meta (
      id integer PRIMARY KEY DEFAULT 1,
      plan text,
      limit_day integer,
      remaining integer,
      last_run_at timestamptz,
      last_summary text,
      beta_2h_json text,
      league_priors_json text,
      updated_at timestamptz NOT NULL
    )
  `;
  // Additive column for DBs created before league_priors_json
  await ddl`ALTER TABLE hist_meta ADD COLUMN IF NOT EXISTS league_priors_json text`;
  await ddl`ALTER TABLE hist_meta ADD COLUMN IF NOT EXISTS model_params_json text`;

  await ddl`
    CREATE TABLE IF NOT EXISTS team_half_stats (
      id serial PRIMARY KEY,
      team_id integer,
      team_name text NOT NULL,
      league_id integer NOT NULL,
      venue text NOT NULL,
      scored_1h real NOT NULL,
      scored_2h real NOT NULL,
      conceded_1h real NOT NULL,
      conceded_2h real NOT NULL,
      sample_size integer NOT NULL,
      thin_data integer NOT NULL DEFAULT 0,
      last_updated timestamptz NOT NULL
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS team_half_stats_team_league_venue_idx ON team_half_stats (team_name, league_id, venue)`;
  await ddl`CREATE INDEX IF NOT EXISTS team_half_stats_league_idx ON team_half_stats (league_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS hist_league_half_params (
      league_id integer NOT NULL,
      comp_type text NOT NULL DEFAULT 'league',
      league_name text NOT NULL,
      s1 real NOT NULL,
      s1_home real NOT NULL,
      s1_away real NOT NULL,
      used_combined_share_home integer NOT NULL DEFAULT 0,
      used_combined_share_away integer NOT NULL DEFAULT 0,
      n_valid integer NOT NULL,
      n_home_goals_sample integer NOT NULL DEFAULT 0,
      n_away_goals_sample integer NOT NULL DEFAULT 0,
      kappa_raw real NOT NULL,
      kappa_adj real NOT NULL,
      p_d1_obs real NOT NULL,
      p_d2_obs real NOT NULL,
      p_d1d2_obs real NOT NULL,
      goals_mean real,
      goals_variance real,
      goals_dispersion real,
      goals_distribution text NOT NULL DEFAULT 'poisson',
      computed_at timestamptz NOT NULL,
      PRIMARY KEY (league_id, comp_type)
    )
  `;

  await ddl`
    CREATE TABLE IF NOT EXISTS team_ratings (
      id serial PRIMARY KEY,
      team_id integer,
      team_name text NOT NULL,
      league_id integer NOT NULL,
      attack_home real NOT NULL,
      attack_away real NOT NULL,
      defence_home real NOT NULL,
      defence_away real NOT NULL,
      corners_intensity real NOT NULL,
      lambda_1h real NOT NULL,
      lambda_2h real NOT NULL,
      ess real NOT NULL,
      seasons_used integer NOT NULL,
      matches_used integer NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE (team_name, league_id)
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS team_ratings_league_idx ON team_ratings (league_id)`;

  await ddl`
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

  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS hthg integer`;
  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS htag integer`;
  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS hc integer`;
  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS ac integer`;
  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS hti integer`;
  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS ati integer`;
  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS b365_home real`;
  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS b365_draw real`;
  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS b365_away real`;
  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS b365_over25 real`;
  await ddl`ALTER TABLE matches ADD COLUMN IF NOT EXISTS b365_under25 real`;

  await ddl`DROP TABLE IF EXISTS user_predictions CASCADE`;
  await ddl`DROP TABLE IF EXISTS user_prediction_lists CASCADE`;
  await ddl`DROP TABLE IF EXISTS predictions CASCADE`;

  await ddl`
    CREATE TABLE IF NOT EXISTS live_leagues (
      league_id integer PRIMARY KEY,
      name text NOT NULL,
      country text,
      season integer NOT NULL,
      logo_url text
    )
  `;

  await ddl`
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

  await ddl`
    CREATE TABLE IF NOT EXISTS live_events (
      id serial PRIMARY KEY,
      fixture_id integer NOT NULL,
      minute integer,
      type text,
      team text,
      player text
    )
  `;

  await ddl`CREATE INDEX IF NOT EXISTS live_fixtures_status_idx ON live_fixtures (status)`;
  await ddl`CREATE INDEX IF NOT EXISTS live_fixtures_kickoff_idx ON live_fixtures (kickoff_utc)`;
  await ddl`CREATE INDEX IF NOT EXISTS live_fixtures_league_season_idx ON live_fixtures (league_id, season)`;
  await ddl`CREATE INDEX IF NOT EXISTS live_events_fixture_idx ON live_events (fixture_id)`;

  // Secondary provider match id (The Stats API `mt_…`; was BeSoccer numeric id)
  await ddl`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS besoccer_match_id text`;
  // If an older integer column exists, widen to text (safe no-op when already text)
  await ddl`
    DO $$ BEGIN
      ALTER TABLE live_fixtures
        ALTER COLUMN besoccer_match_id TYPE text
        USING besoccer_match_id::text;
    EXCEPTION WHEN others THEN NULL;
    END $$
  `;
  await ddl`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS home_corners integer`;
  await ddl`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS away_corners integer`;
  await ddl`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS home_shots integer`;
  await ddl`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS away_shots integer`;
  await ddl`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS home_possession integer`;
  await ddl`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS away_possession integer`;
  await ddl`ALTER TABLE live_fixtures ADD COLUMN IF NOT EXISTS source_conflicts text`;

  /** Portfolio slip builder — probability fields only. */
  await ddl`
    CREATE TABLE IF NOT EXISTS slip_batches (
      id serial PRIMARY KEY,
      created_at timestamptz NOT NULL,
      preferences_json text NOT NULL,
      user_note text,
      batch_number integer NOT NULL,
      fixture_exclusion_ids text,
      partial_reason text,
      regenerated_from_id integer
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS slip_batches_created_idx ON slip_batches (created_at)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS slip_batch_legs (
      id serial PRIMARY KEY,
      batch_id integer NOT NULL,
      slip_index integer NOT NULL,
      leg_order integer NOT NULL,
      fixture_id text NOT NULL,
      batch_id_source text,
      competition text NOT NULL,
      kickoff_utc timestamptz,
      market_family text NOT NULL,
      selection_label text NOT NULL,
      selection_key text NOT NULL,
      line real,
      combo_id text,
      p_calibrated real NOT NULL,
      p_raw real NOT NULL,
      n_effective real NOT NULL,
      calibrated integer NOT NULL DEFAULT 0,
      mean_rho real,
      independence_upper real,
      band_lower real,
      band_upper real,
      selection_source text NOT NULL DEFAULT 'machine',
      machine_rank integer,
      correlation_contribution real,
      home_team text,
      away_team text,
      outcome text
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS slip_batch_legs_batch_idx ON slip_batch_legs (batch_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS slip_batch_legs_fixture_idx ON slip_batch_legs (fixture_id)`;

  /* Additive core_* / audit_* — CREATE IF NOT EXISTS only (no DROP/RENAME). */
  await ddl`
    CREATE TABLE IF NOT EXISTS core_competition (
      id serial PRIMARY KEY,
      provider_name text NOT NULL DEFAULT 'api-sports',
      provider_competition_id integer NOT NULL,
      name text NOT NULL,
      country text,
      comp_type text NOT NULL,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS core_competition_provider_uidx ON core_competition (provider_name, provider_competition_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_season (
      id serial PRIMARY KEY,
      competition_id integer NOT NULL,
      provider_season integer NOT NULL,
      label text,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS core_season_comp_season_uidx ON core_season (competition_id, provider_season)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_team (
      id serial PRIMARY KEY,
      provider_name text NOT NULL DEFAULT 'api-sports',
      provider_team_id integer NOT NULL,
      canonical_name text NOT NULL,
      country text,
      logo_url text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS core_team_provider_uidx ON core_team (provider_name, provider_team_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_team_alias (
      id serial PRIMARY KEY,
      team_id integer NOT NULL,
      alias_normalized text NOT NULL,
      alias_raw text NOT NULL,
      source text NOT NULL,
      approved integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS core_team_alias_norm_team_uidx ON core_team_alias (alias_normalized, team_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS core_team_alias_norm_idx ON core_team_alias (alias_normalized)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_fixture (
      id serial PRIMARY KEY,
      provider_name text NOT NULL DEFAULT 'api-sports',
      provider_fixture_id integer NOT NULL,
      competition_id integer,
      season_id integer,
      home_team_id integer,
      away_team_id integer,
      home_team_name text NOT NULL,
      away_team_name text NOT NULL,
      kickoff_utc timestamptz NOT NULL,
      status text NOT NULL,
      ht_home integer,
      ht_away integer,
      ft_home integer,
      ft_away integer,
      venue text,
      round text,
      manual_verified integer NOT NULL DEFAULT 0,
      source_updated_at timestamptz,
      imported_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS core_fixture_provider_uidx ON core_fixture (provider_name, provider_fixture_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS core_fixture_pair_date_idx ON core_fixture (home_team_name, away_team_name, kickoff_utc)`;
  await ddl`CREATE INDEX IF NOT EXISTS core_fixture_status_date_idx ON core_fixture (status, kickoff_utc)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_fixture_statistic (
      id serial PRIMARY KEY,
      fixture_id integer NOT NULL,
      team_id integer,
      side text NOT NULL,
      stat_key text NOT NULL,
      stat_value integer,
      manual_verified integer NOT NULL DEFAULT 0,
      source_updated_at timestamptz
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS core_fixture_stat_fixture_side_key_uidx ON core_fixture_statistic (fixture_id, side, stat_key)`;
  await ddl`CREATE INDEX IF NOT EXISTS core_fixture_stat_fixture_idx ON core_fixture_statistic (fixture_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_provider_ingestion (
      id serial PRIMARY KEY,
      provider_name text NOT NULL,
      request_fingerprint text NOT NULL,
      payload_hash text,
      endpoint text,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS core_provider_ingestion_fp_idx ON core_provider_ingestion (request_fingerprint)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_legacy_record_map (
      id serial PRIMARY KEY,
      legacy_source_table text NOT NULL,
      legacy_pk text NOT NULL,
      canonical_entity_type text NOT NULL,
      canonical_entity_id integer NOT NULL,
      verified integer NOT NULL DEFAULT 1,
      notes text,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS core_legacy_record_map_uidx ON core_legacy_record_map (legacy_source_table, legacy_pk)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_prediction_run (
      id serial PRIMARY KEY,
      run_key text,
      model_version text,
      input_snapshot_hash text,
      meta_json text,
      created_at timestamptz NOT NULL
    )
  `;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_market_probability (
      id serial PRIMARY KEY,
      prediction_run_id integer,
      fixture_id integer,
      market_key text NOT NULL,
      selection_key text NOT NULL,
      probability real,
      trace_json text,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS core_market_probability_run_idx ON core_market_probability (prediction_run_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS core_market_probability_fixture_idx ON core_market_probability (fixture_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_result_trace (
      id serial PRIMARY KEY,
      batch_id text NOT NULL,
      match_id text NOT NULL,
      home_team_name text NOT NULL,
      away_team_name text NOT NULL,
      match_date text,
      status text NOT NULL,
      provider_fixture_id integer,
      core_fixture_id integer,
      evidence_json text,
      checked_at timestamptz,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS core_result_trace_batch_match_uidx ON core_result_trace (batch_id, match_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS core_result_trace_status_idx ON core_result_trace (status)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS prediction_log_settlement (
      id serial PRIMARY KEY,
      batch_id text NOT NULL,
      match_id text NOT NULL,
      league text,
      home_team text NOT NULL,
      away_team text NOT NULL,
      match_date text,
      ft_home integer NOT NULL,
      ft_away integer NOT NULL,
      ht_home integer NOT NULL,
      ht_away integer NOT NULL,
      match_ht_total integer NOT NULL,
      match_2h_total integer NOT NULL,
      corners_home integer NOT NULL,
      corners_away integer NOT NULL,
      goal_timing_json text,
      provider_fixture_id integer,
      core_fixture_id integer,
      source text NOT NULL DEFAULT 'prediction_log_batch',
      filled_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS prediction_log_settlement_batch_match_uidx ON prediction_log_settlement (batch_id, match_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS prediction_log_settlement_batch_idx ON prediction_log_settlement (batch_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS prediction_log_settlement_core_fixture_idx ON prediction_log_settlement (core_fixture_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS ai_learner_pick_outcomes (
      id serial PRIMARY KEY,
      batch_id text NOT NULL,
      match_id text NOT NULL,
      provider_fixture_id integer,
      weekend_surface text NOT NULL,
      league text,
      home_team text NOT NULL,
      away_team text NOT NULL,
      match_date text,
      market_key text NOT NULL,
      prediction text NOT NULL,
      line real,
      confidence integer,
      result text NOT NULL,
      actual_value text,
      loss_reason text,
      ft_home integer,
      ft_away integer,
      ht_home integer,
      ht_away integer,
      corners_home integer,
      corners_away integer,
      filled_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS ai_learner_pick_outcomes_batch_match_market_uidx ON ai_learner_pick_outcomes (batch_id, match_id, market_key)`;
  await ddl`CREATE INDEX IF NOT EXISTS ai_learner_pick_outcomes_batch_idx ON ai_learner_pick_outcomes (batch_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS ai_learner_pick_outcomes_league_idx ON ai_learner_pick_outcomes (league)`;
  await ddl`CREATE INDEX IF NOT EXISTS ai_learner_pick_outcomes_result_idx ON ai_learner_pick_outcomes (result)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS ai_learner_market_rules (
      id serial PRIMARY KEY,
      league text NOT NULL,
      lost_market text NOT NULL,
      lost_prediction text NOT NULL,
      lost_line real,
      win_market text NOT NULL,
      win_prediction text NOT NULL,
      win_line real,
      wins integer NOT NULL DEFAULT 0,
      losses integer NOT NULL DEFAULT 0,
      sample integer NOT NULL DEFAULT 0,
      win_rate integer,
      rule_text text NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS ai_learner_market_rules_rule_uidx ON ai_learner_market_rules (league, lost_market, lost_prediction, lost_line, win_market, win_prediction, win_line)`;
  await ddl`CREATE INDEX IF NOT EXISTS ai_learner_market_rules_league_idx ON ai_learner_market_rules (league)`;
  await ddl`CREATE INDEX IF NOT EXISTS ai_learner_market_rules_lost_market_idx ON ai_learner_market_rules (lost_market)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS ai_learner_stats_snapshot (
      id text PRIMARY KEY,
      stats_json text NOT NULL,
      total_scored_picks integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL
    )
  `;

  await ddl`
    CREATE TABLE IF NOT EXISTS ai_learner_market_reliability (
      id serial PRIMARY KEY,
      team text NOT NULL,
      league text NOT NULL,
      market_family text NOT NULL,
      selection text NOT NULL,
      line real,
      wins integer NOT NULL DEFAULT 0,
      losses integer NOT NULL DEFAULT 0,
      sample integer NOT NULL DEFAULT 0,
      win_rate integer,
      rule_text text NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS ai_learner_market_reliability_uidx ON ai_learner_market_reliability (team, league, market_family, selection, line)`;
  await ddl`CREATE INDEX IF NOT EXISTS ai_learner_market_reliability_team_idx ON ai_learner_market_reliability (team)`;
  await ddl`CREATE INDEX IF NOT EXISTS ai_learner_market_reliability_league_idx ON ai_learner_market_reliability (league)`;
  await ddl`CREATE INDEX IF NOT EXISTS ai_learner_market_reliability_family_idx ON ai_learner_market_reliability (market_family)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS weekend_market_win_results (
      id serial PRIMARY KEY,
      weekend_batch_id text NOT NULL,
      match_id text NOT NULL,
      provider_fixture_id integer,
      league text,
      home_team text NOT NULL,
      away_team text NOT NULL,
      match_date text,
      selection text NOT NULL,
      line real,
      actual_value text,
      result text NOT NULL,
      was_weekend_pick integer NOT NULL DEFAULT 0,
      filled_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS weekend_market_win_results_uidx ON weekend_market_win_results (weekend_batch_id, match_id, selection, line)`;
  await ddl`CREATE INDEX IF NOT EXISTS weekend_market_win_results_batch_idx ON weekend_market_win_results (weekend_batch_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS weekend_market_win_results_league_idx ON weekend_market_win_results (league)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS weekend_market_half_goal_results (
      id serial PRIMARY KEY,
      weekend_batch_id text NOT NULL,
      match_id text NOT NULL,
      provider_fixture_id integer,
      league text,
      home_team text NOT NULL,
      away_team text NOT NULL,
      match_date text,
      selection text NOT NULL,
      line real,
      actual_value text,
      result text NOT NULL,
      was_weekend_pick integer NOT NULL DEFAULT 0,
      filled_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS weekend_market_half_goal_results_uidx ON weekend_market_half_goal_results (weekend_batch_id, match_id, selection, line)`;
  await ddl`CREATE INDEX IF NOT EXISTS weekend_market_half_goal_results_batch_idx ON weekend_market_half_goal_results (weekend_batch_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS weekend_market_corner_results (
      id serial PRIMARY KEY,
      weekend_batch_id text NOT NULL,
      match_id text NOT NULL,
      provider_fixture_id integer,
      league text,
      home_team text NOT NULL,
      away_team text NOT NULL,
      match_date text,
      selection text NOT NULL,
      line real,
      actual_value text,
      result text NOT NULL,
      was_weekend_pick integer NOT NULL DEFAULT 0,
      corners_1h_home integer,
      corners_1h_away integer,
      corners_2h_home integer,
      corners_2h_away integer,
      filled_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS weekend_market_corner_results_uidx ON weekend_market_corner_results (weekend_batch_id, match_id, selection, line)`;
  await ddl`CREATE INDEX IF NOT EXISTS weekend_market_corner_results_batch_idx ON weekend_market_corner_results (weekend_batch_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS weekend_market_combo_results (
      id serial PRIMARY KEY,
      weekend_batch_id text NOT NULL,
      match_id text NOT NULL,
      provider_fixture_id integer,
      league text,
      home_team text NOT NULL,
      away_team text NOT NULL,
      match_date text,
      selection text NOT NULL,
      line real,
      actual_value text,
      result text NOT NULL,
      was_weekend_pick integer NOT NULL DEFAULT 0,
      filled_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS weekend_market_combo_results_uidx ON weekend_market_combo_results (weekend_batch_id, match_id, selection, line)`;
  await ddl`CREATE INDEX IF NOT EXISTS weekend_market_combo_results_batch_idx ON weekend_market_combo_results (weekend_batch_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS weekend_market_btts_halves_results (
      id serial PRIMARY KEY,
      weekend_batch_id text NOT NULL,
      match_id text NOT NULL,
      provider_fixture_id integer,
      league text,
      home_team text NOT NULL,
      away_team text NOT NULL,
      match_date text,
      selection text NOT NULL,
      line real,
      actual_value text,
      result text NOT NULL,
      was_weekend_pick integer NOT NULL DEFAULT 0,
      filled_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS weekend_market_btts_halves_results_uidx ON weekend_market_btts_halves_results (weekend_batch_id, match_id, selection, line)`;
  await ddl`CREATE INDEX IF NOT EXISTS weekend_market_btts_halves_results_batch_idx ON weekend_market_btts_halves_results (weekend_batch_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS weekend_market_draw_half_results (
      id serial PRIMARY KEY,
      weekend_batch_id text NOT NULL,
      match_id text NOT NULL,
      provider_fixture_id integer,
      league text,
      home_team text NOT NULL,
      away_team text NOT NULL,
      match_date text,
      selection text NOT NULL,
      line real,
      actual_value text,
      result text NOT NULL,
      was_weekend_pick integer NOT NULL DEFAULT 0,
      filled_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS weekend_market_draw_half_results_uidx ON weekend_market_draw_half_results (weekend_batch_id, match_id, selection, line)`;
  await ddl`CREATE INDEX IF NOT EXISTS weekend_market_draw_half_results_batch_idx ON weekend_market_draw_half_results (weekend_batch_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS weekend_market_total_goals_results (
      id serial PRIMARY KEY,
      weekend_batch_id text NOT NULL,
      match_id text NOT NULL,
      provider_fixture_id integer,
      league text,
      home_team text NOT NULL,
      away_team text NOT NULL,
      match_date text,
      selection text NOT NULL,
      line real,
      actual_value text,
      result text NOT NULL,
      was_weekend_pick integer NOT NULL DEFAULT 0,
      filled_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS weekend_market_total_goals_results_uidx ON weekend_market_total_goals_results (weekend_batch_id, match_id, selection, line)`;
  await ddl`CREATE INDEX IF NOT EXISTS weekend_market_total_goals_results_batch_idx ON weekend_market_total_goals_results (weekend_batch_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS weekend_market_stats_results (
      id serial PRIMARY KEY,
      weekend_batch_id text NOT NULL,
      match_id text NOT NULL,
      provider_fixture_id integer,
      league text,
      home_team text NOT NULL,
      away_team text NOT NULL,
      match_date text,
      selection text NOT NULL,
      line real,
      actual_value text,
      result text NOT NULL,
      was_weekend_pick integer NOT NULL DEFAULT 0,
      filled_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS weekend_market_stats_results_uidx ON weekend_market_stats_results (weekend_batch_id, match_id, selection, line)`;
  await ddl`CREATE INDEX IF NOT EXISTS weekend_market_stats_results_batch_idx ON weekend_market_stats_results (weekend_batch_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_coverage_audit (
      id serial PRIMARY KEY,
      competition_id integer NOT NULL,
      season_id integer NOT NULL,
      expected_fixtures integer,
      imported_fixtures integer,
      with_ht integer,
      with_stats integer,
      with_corners integer,
      completeness text,
      inventory_pass integer NOT NULL DEFAULT 0,
      provider_hole integer NOT NULL DEFAULT 0,
      provider_hole_reason text,
      audited_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS core_coverage_audit_comp_season_uidx ON core_coverage_audit (competition_id, season_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS audit_data_change_log (
      id serial PRIMARY KEY,
      entity_type text NOT NULL,
      entity_id integer,
      action text NOT NULL,
      diff_json text,
      actor text,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS audit_data_change_log_entity_idx ON audit_data_change_log (entity_type, entity_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS audit_data_change_log_created_idx ON audit_data_change_log (created_at)`;

  await ddl`
    CREATE OR REPLACE VIEW analytics_v_fixture_compat AS
    SELECT
      f.id AS core_fixture_id,
      f.provider_fixture_id,
      f.provider_name,
      f.competition_id,
      f.season_id,
      f.home_team_id,
      f.away_team_id,
      f.home_team_name,
      f.away_team_name,
      f.kickoff_utc,
      f.status,
      f.ht_home,
      f.ht_away,
      f.ft_home,
      f.ft_away,
      f.venue,
      f.round,
      f.manual_verified,
      hs.stat_value AS home_corners,
      as_.stat_value AS away_corners
    FROM core_fixture f
    LEFT JOIN core_fixture_statistic hs
      ON hs.fixture_id = f.id AND hs.side = 'home' AND hs.stat_key = 'corners'
    LEFT JOIN core_fixture_statistic as_
      ON as_.fixture_id = f.id AND as_.side = 'away' AND as_.stat_key = 'corners'
  `;

  await ddl`
    CREATE TABLE IF NOT EXISTS core_analysis_run (
      id serial PRIMARY KEY,
      page_id text NOT NULL,
      mode text NOT NULL,
      configured_api_weight real NOT NULL,
      configured_system_weight real NOT NULL,
      effective_api_weight real NOT NULL,
      effective_system_weight real NOT NULL,
      api_record_count integer NOT NULL DEFAULT 0,
      system_record_count integer NOT NULL DEFAULT 0,
      api_date_from text,
      api_date_to text,
      system_date_from text,
      system_date_to text,
      calculation_version text NOT NULL,
      status text NOT NULL,
      fallback_reason text,
      warnings_json text,
      meta_json text,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS core_analysis_run_page_idx ON core_analysis_run (page_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS core_analysis_run_created_idx ON core_analysis_run (created_at)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS market_advisory_runs (
      id serial PRIMARY KEY,
      advisory_run_id text NOT NULL,
      fixture_id integer NOT NULL,
      generated_at timestamptz NOT NULL,
      prediction_cutoff_at timestamptz NOT NULL,
      canonical_probability_snapshot_id text,
      existing_selector_snapshot_id text,
      msam_model_version text NOT NULL,
      collaboration_policy_version text NOT NULL,
      data_policy_version text NOT NULL,
      status text NOT NULL,
      input_lineage_hash text NOT NULL,
      meta_json text,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS market_advisory_runs_run_id_uidx ON market_advisory_runs (advisory_run_id)`;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS market_advisory_runs_fixture_cutoff_uidx ON market_advisory_runs (fixture_id, prediction_cutoff_at, msam_model_version, collaboration_policy_version)`;
  await ddl`CREATE INDEX IF NOT EXISTS market_advisory_runs_fixture_idx ON market_advisory_runs (fixture_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS market_advisory_candidates (
      id serial PRIMARY KEY,
      advisory_run_id text NOT NULL,
      market_code text NOT NULL,
      market_family text NOT NULL,
      conflict_group text NOT NULL,
      market_definition_hash text NOT NULL,
      market_definition_json text,
      raw_probability real,
      calibrated_probability real,
      probability_lower real,
      probability_upper real,
      eligible integer NOT NULL DEFAULT 0,
      ineligibility_reason_codes text,
      ops real, cqs real, ecs real, sss real, iss real, dis real,
      msam_score real,
      existing_normalized_score real,
      msam_normalized_score real,
      final_advisory_score real,
      selection_role text,
      primary_rank integer,
      agreement_status text,
      explanation_snapshot_json text,
      diagnostic_snapshot_json text,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS market_advisory_candidates_run_market_uidx ON market_advisory_candidates (advisory_run_id, market_code, market_definition_hash)`;
  await ddl`CREATE INDEX IF NOT EXISTS market_advisory_candidates_run_idx ON market_advisory_candidates (advisory_run_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS market_advisory_source_coverage (
      id serial PRIMARY KEY,
      advisory_run_id text NOT NULL,
      market_code text,
      feature_family text,
      target_api_weight real,
      target_system_weight real,
      effective_api_weight real,
      effective_system_weight real,
      api_record_count integer,
      system_record_count integer,
      effective_sample_size real,
      completeness_json text,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS market_advisory_source_coverage_run_idx ON market_advisory_source_coverage (advisory_run_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS market_calibration_metrics (
      id serial PRIMARY KEY,
      market_code text,
      market_family text,
      competition_scope text,
      probability_bin text,
      time_window text,
      model_version text,
      sample_size integer,
      effective_sample_size real,
      brier_score real,
      log_loss real,
      reliability_json text,
      baseline_comparison_json text,
      validation_cutoff timestamptz,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS market_calibration_metrics_scope_idx ON market_calibration_metrics (market_family, competition_scope)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS market_advisory_config_versions (
      id serial PRIMARY KEY,
      version_key text NOT NULL,
      config_json text NOT NULL,
      promoted_at timestamptz,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE UNIQUE INDEX IF NOT EXISTS market_advisory_config_versions_key_uidx ON market_advisory_config_versions (version_key)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS market_advisory_audit_events (
      id serial PRIMARY KEY,
      advisory_run_id text,
      event_type text NOT NULL,
      payload_json text,
      created_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS market_advisory_audit_events_run_idx ON market_advisory_audit_events (advisory_run_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS market_advisory_audit_events_type_idx ON market_advisory_audit_events (event_type)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS system_season_fixtures (
      fixture_id integer PRIMARY KEY,
      league_id integer NOT NULL,
      season integer NOT NULL,
      date_utc timestamptz NOT NULL,
      home_id integer,
      away_id integer,
      home_team text NOT NULL,
      away_team text NOT NULL,
      venue text,
      ht_home integer,
      ht_away integer,
      ft_home integer,
      ft_away integer,
      status text NOT NULL,
      data_completeness text NOT NULL DEFAULT 'core-only',
      locked integer NOT NULL DEFAULT 0,
      synced_at timestamptz NOT NULL
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS system_season_fixtures_league_season_idx ON system_season_fixtures (league_id, season)`;
  await ddl`CREATE INDEX IF NOT EXISTS system_season_fixtures_date_idx ON system_season_fixtures (date_utc)`;
  await ddl`CREATE INDEX IF NOT EXISTS system_season_fixtures_home_id_idx ON system_season_fixtures (home_id)`;
  await ddl`CREATE INDEX IF NOT EXISTS system_season_fixtures_away_id_idx ON system_season_fixtures (away_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS system_season_goals (
      id serial PRIMARY KEY,
      fixture_id integer NOT NULL,
      team_id integer,
      minute integer,
      extra_minute integer,
      half text NOT NULL,
      player text,
      type text
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS system_season_goals_fixture_idx ON system_season_goals (fixture_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS system_season_stats (
      id serial PRIMARY KEY,
      fixture_id integer NOT NULL,
      team_id integer NOT NULL,
      shots integer,
      sot integer,
      possession integer,
      corners integer,
      yellow integer,
      red integer,
      fouls integer,
      offsides integer
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS system_season_stats_fixture_team_idx ON system_season_stats (fixture_id, team_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS system_season_lineups (
      id serial PRIMARY KEY,
      fixture_id integer NOT NULL,
      team_id integer NOT NULL,
      formation text,
      starting_json text,
      substitutes_json text
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS system_season_lineups_fixture_team_idx ON system_season_lineups (fixture_id, team_id)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS system_season_team_rates (
      team_id integer NOT NULL,
      league_id integer NOT NULL,
      season integer NOT NULL,
      team_name text NOT NULL,
      n_matches integer NOT NULL DEFAULT 0,
      af1 real,
      af2 real,
      da1 real,
      da2 real,
      avg_corners_for real,
      avg_corners_against real,
      data_completeness text NOT NULL DEFAULT 'core-only',
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (team_id, league_id, season)
    )
  `;
  await ddl`CREATE INDEX IF NOT EXISTS system_season_team_rates_league_season_idx ON system_season_team_rates (league_id, season)`;

  await ddl`
    CREATE TABLE IF NOT EXISTS system_season_sync_meta (
      league_id integer PRIMARY KEY,
      season integer NOT NULL,
      last_run_at timestamptz,
      last_error text,
      fixtures_synced integer NOT NULL DEFAULT 0,
      cursor_fixture_id integer,
      backfill_complete integer NOT NULL DEFAULT 0
    )
  `;

  await ddl`
    INSERT INTO app_schema_meta (id, version, updated_at)
    VALUES (1, ${SCHEMA_BOOTSTRAP_VERSION}, now())
    ON CONFLICT (id) DO UPDATE
    SET version = EXCLUDED.version, updated_at = EXCLUDED.updated_at
  `;

  initialized = true;
  agentLog(
    "lib/db/init.ts:done",
    "ensureSchema complete",
    { version: SCHEMA_BOOTSTRAP_VERSION },
    "H1"
  );
}
