import { neon } from "@neondatabase/serverless";

let initialized = false;

export async function ensureSchema(): Promise<void> {
  if (initialized) return;
  const url =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL;
  if (!url) return;

  const sql = neon(url);

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

  initialized = true;
}
