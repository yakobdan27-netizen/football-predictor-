/**
 * Sample finished hist fixtures vs analytics_v_fixture_compat.
 * Pages still read legacy — this only asserts dual-read equality for verified maps.
 *
 * Run: npx tsx scripts/core-shadow-compare.ts --sample 50
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";

function loadEnvFile(name: string) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

function parseSample(argv: string[]): number {
  const i = argv.indexOf("--sample");
  if (i >= 0 && argv[i + 1]) return parseInt(argv[i + 1]!, 10) || 50;
  return 50;
}

type Row = {
  fixture_id: number;
  home_team: string;
  away_team: string;
  ft_home: number | null;
  ft_away: number | null;
  ht_home: number | null;
  ht_away: number | null;
  home_corners: number | null;
  away_corners: number | null;
  v_home: string | null;
  v_away: string | null;
  v_ft_home: number | null;
  v_ft_away: number | null;
  v_ht_home: number | null;
  v_ht_away: number | null;
  v_home_corners: number | null;
  v_away_corners: number | null;
};

async function main() {
  const sample = parseSample(process.argv.slice(2));
  const { ensureSchema } = await import("../lib/db/init");
  const { getDb } = await import("../lib/db");
  await ensureSchema();
  const db = await getDb();

  const query = `
    SELECT
      h.fixture_id,
      h.home_team,
      h.away_team,
      h.ft_home,
      h.ft_away,
      h.ht_home,
      h.ht_away,
      (
        SELECT s.corners FROM hist_stats s
        WHERE s.fixture_id = h.fixture_id AND s.team_id = h.home_id
        LIMIT 1
      ) AS home_corners,
      (
        SELECT s.corners FROM hist_stats s
        WHERE s.fixture_id = h.fixture_id AND s.team_id = h.away_id
        LIMIT 1
      ) AS away_corners,
      v.home_team_name AS v_home,
      v.away_team_name AS v_away,
      v.ft_home AS v_ft_home,
      v.ft_away AS v_ft_away,
      v.ht_home AS v_ht_home,
      v.ht_away AS v_ht_away,
      v.home_corners AS v_home_corners,
      v.away_corners AS v_away_corners
    FROM hist_fixtures h
    INNER JOIN core_legacy_record_map m
      ON m.legacy_source_table = 'hist_fixtures'
     AND m.legacy_pk = h.fixture_id::text
     AND m.verified = 1
    INNER JOIN analytics_v_fixture_compat v
      ON v.core_fixture_id = m.canonical_entity_id
    WHERE upper(h.status) IN ('FT','AET','PEN')
    ORDER BY h.fixture_id DESC
    LIMIT ${sample}
  `;

  const r = await db.execute(sql.raw(query));
  const rows = (
    Array.isArray(r)
      ? r
      : ((r as unknown as { rows?: Row[] }).rows ?? [])
  ) as Row[];

  let compared = 0;
  let mismatches = 0;
  const examples: string[] = [];

  for (const row of rows) {
    compared++;
    const diffs: string[] = [];
    if (row.home_team !== row.v_home) diffs.push(`home ${row.home_team}≠${row.v_home}`);
    if (row.away_team !== row.v_away) diffs.push(`away ${row.away_team}≠${row.v_away}`);
    if (row.ft_home !== row.v_ft_home) diffs.push(`ft_home ${row.ft_home}≠${row.v_ft_home}`);
    if (row.ft_away !== row.v_ft_away) diffs.push(`ft_away ${row.ft_away}≠${row.v_ft_away}`);
    if (row.ht_home !== row.v_ht_home) diffs.push(`ht_home ${row.ht_home}≠${row.v_ht_home}`);
    if (row.ht_away !== row.v_ht_away) diffs.push(`ht_away ${row.ht_away}≠${row.v_ht_away}`);
    if (row.home_corners !== row.v_home_corners) {
      diffs.push(`home_corners ${row.home_corners}≠${row.v_home_corners}`);
    }
    if (row.away_corners !== row.v_away_corners) {
      diffs.push(`away_corners ${row.away_corners}≠${row.v_away_corners}`);
    }
    if (diffs.length) {
      mismatches++;
      if (examples.length < 15) {
        examples.push(`fixture ${row.fixture_id}: ${diffs.join("; ")}`);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        sample,
        compared,
        mismatches,
        ok: mismatches === 0,
        examples,
        note: "Pages still read legacy; CORE_SHADOW_FIXTURE_READ only logs diffs in helpers.",
      },
      null,
      2
    )
  );

  if (compared === 0) {
    console.warn("No verified mapped fixtures to compare — run core-backfill first");
    process.exit(2);
  }
  if (mismatches > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
