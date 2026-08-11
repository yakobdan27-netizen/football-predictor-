/**
 * Integrity checks: hist_fixtures vs core maps + SQL sanity.
 * Run: npx tsx scripts/core-reconcile.ts
 * Writes docs/reports/core-reconcile-<date>.md and exits ≠ 0 on unexplained gaps.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";

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

async function main() {
  const { ensureSchema } = await import("../lib/db/init");
  const { getDb } = await import("../lib/db");
  const { sqlCount } = await import("../lib/core/sql-count");
  await ensureSchema();
  const db = await getDb();

  const histFixtures = await sqlCount(db, "SELECT count(*)::int AS c FROM hist_fixtures");
  const mappedVerified = await sqlCount(
    db,
    `SELECT count(*)::int AS c FROM core_legacy_record_map
     WHERE legacy_source_table = 'hist_fixtures' AND verified = 1`
  );
  const coreFixtures = await sqlCount(db, "SELECT count(*)::int AS c FROM core_fixture");
  const unresolved = Math.max(0, histFixtures - mappedVerified);

  const finishedNoScores = await sqlCount(
    db,
    `SELECT count(*)::int AS c FROM core_fixture
     WHERE upper(status) IN ('FT','AET','PEN')
       AND (ft_home IS NULL OR ft_away IS NULL)`
  );
  const selfFixtures = await sqlCount(
    db,
    `SELECT count(*)::int AS c FROM core_fixture
     WHERE home_team_id IS NOT NULL AND home_team_id = away_team_id`
  );
  const dupProvider = await sqlCount(
    db,
    `SELECT count(*)::int AS c FROM (
       SELECT provider_name, provider_fixture_id
       FROM core_fixture
       GROUP BY provider_name, provider_fixture_id
       HAVING count(*) > 1
     ) d`
  );
  const orphanStats = await sqlCount(
    db,
    `SELECT count(*)::int AS c FROM core_fixture_statistic s
     LEFT JOIN core_fixture f ON f.id = s.fixture_id
     WHERE f.id IS NULL`
  );
  const rejected = await sqlCount(
    db,
    `SELECT count(*)::int AS c FROM core_legacy_record_map
     WHERE legacy_source_table = 'hist_fixtures' AND verified = 0`
  );

  const checks = {
    hist_fixtures: histFixtures,
    mapped_verified: mappedVerified,
    unresolved,
    rejected,
    core_fixtures: coreFixtures,
    finished_without_scores: finishedNoScores,
    self_fixtures: selfFixtures,
    duplicate_provider_ids: dupProvider,
    orphan_stats: orphanStats,
  };

  const failures: string[] = [];
  if (dupProvider > 0) failures.push(`duplicate provider fixture ids: ${dupProvider}`);
  if (selfFixtures > 0) failures.push(`self-fixtures: ${selfFixtures}`);
  if (orphanStats > 0) failures.push(`orphan stats: ${orphanStats}`);
  // Unresolved is expected before/during backfill — fail only if maps exist but diverge oddly
  if (mappedVerified > 0 && unresolved > histFixtures * 0.05) {
    failures.push(
      `unexplained gap: unresolved=${unresolved} (>5% of hist_fixtures=${histFixtures})`
    );
  }
  if (mappedVerified === 0 && histFixtures > 0) {
    // Not a hard fail — report as warning (empty core layer)
    failures.push(
      `no verified maps yet (hist_fixtures=${histFixtures}) — run core-backfill`
    );
  }

  const date = new Date().toISOString().slice(0, 10);
  const reportDir = join(process.cwd(), "docs", "reports");
  mkdirSync(reportDir, { recursive: true });
  const outPath = join(reportDir, `core-reconcile-${date}.md`);

  const md = [
    `# Core reconcile report (${date})`,
    "",
    "```",
    `hist_fixtures rows = mapped verified + unresolved + rejected`,
    `${histFixtures} = ${mappedVerified} + ${unresolved} + ${rejected}`,
    "```",
    "",
    "## Checks",
    "",
    "| Check | Count |",
    "|---|---|",
    ...Object.entries(checks).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Failures",
    "",
    failures.length ? failures.map((f) => `- ${f}`).join("\n") : "- none",
    "",
    "## JSON",
    "",
    "```json",
    JSON.stringify({ checks, failures }, null, 2),
    "```",
    "",
  ].join("\n");

  writeFileSync(outPath, md, "utf8");
  console.log(md);
  console.log(`Wrote ${outPath}`);

  // Exit non-zero on integrity violations (dupes/orphans/self), not on empty maps alone
  const hard =
    dupProvider > 0 || selfFixtures > 0 || orphanStats > 0;
  if (hard) process.exit(1);
  if (mappedVerified === 0 && histFixtures > 0) {
    console.warn("WARN: core layer empty — soft fail exit 2");
    process.exit(2);
  }
  if (failures.some((f) => f.includes("unexplained gap"))) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
