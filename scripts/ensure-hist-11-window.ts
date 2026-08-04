/**
 * Expand hist_jobs to the 11-completed-season window (pending only for missing cells).
 * Does not reset done jobs. Then print coverage summary.
 *
 * Run: npx tsx scripts/ensure-hist-11-window.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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
  const {
    HIST_COMPLETED_SEASON_COUNT,
    HIST_SEASON_DECAY_BASE,
    histSeasonYears,
    histJobKeys,
    histSeasonWeight,
    currentHistSeason,
  } = await import("../lib/hist/seasons");
  const { ensureHistJobs, histJobsSummary } = await import("../lib/hist/store");
  const { ensureSchema } = await import("../lib/db/init");
  const { auditHistCoverage, formatCoverageTable } = await import(
    "../lib/hist/coverage-audit"
  );

  await ensureSchema();

  const seasons = histSeasonYears({ includeCurrent: false });
  const current = currentHistSeason();
  console.log("HIST_COMPLETED_SEASON_COUNT", HIST_COMPLETED_SEASON_COUNT);
  console.log("HIST_SEASON_DECAY_BASE", HIST_SEASON_DECAY_BASE);
  console.log("current season", current);
  console.log("completed seasons", seasons.join(", "));
  console.log(
    "weights (ago 0..10)",
    Array.from({ length: 11 }, (_, i) =>
      histSeasonWeight(current - i, current).toFixed(3)
    ).join(", ")
  );
  console.log("job keys expected", histJobKeys().length);

  const n = await ensureHistJobs();
  console.log("ensureHistJobs →", n);
  const summary = await histJobsSummary();
  console.log("hist_jobs summary", summary);

  const report = await auditHistCoverage();
  console.log(formatCoverageTable(report));
  console.log("coverage summary", report.summary);
  console.log(
    "\nNext: drain gaps with cron /api/cron/hist-backfill or npx tsx scripts/run-hist-gap-backfill.ts"
  );
  console.log(
    "After coverage improves: npx tsx scripts/recompute-hist-model-inputs.ts"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
