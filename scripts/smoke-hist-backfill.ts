/**
 * One-shot smoke: preflight + single hist chunk.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(name: string) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
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
  const { runHistPreflight } = await import("../lib/hist/preflight");
  const { histSeasonYears, HIST_BIG5_LEAGUES } = await import(
    "../lib/hist/seasons"
  );
  const { ensureHistJobs, histJobsSummary } = await import("../lib/hist/store");
  const { runHistBackfillChunk } = await import("../lib/hist/backfill");

  console.log("ensureSchema…");
  await ensureSchema();
  console.log("preflight…");
  const pf = await runHistPreflight();
  console.log(
    "PREFLIGHT",
    JSON.stringify({
      ok: pf.ok,
      plan: pf.plan,
      limitDay: pf.limitDay,
      remaining: pf.remaining,
      maxEnrichToday: pf.maxEnrichToday,
      abort: pf.abort,
      reason: pf.reason,
    })
  );
  console.log("SEASONS", histSeasonYears());
  console.log(
    "LEAGUES",
    HIST_BIG5_LEAGUES.map((l) => `${l.id}:${l.name}`).join(", ")
  );
  console.log("ensureHistJobs…");
  await ensureHistJobs();
  console.log("ensureHistJobs done");

  if (pf.abort) {
    console.log("SKIP_CHUNK", pf.reason);
    return;
  }

  console.log("chunk…");
  const summary = await runHistBackfillChunk();
  console.log(
    "CHUNK",
    JSON.stringify({
      ok: summary.ok,
      leagueName: summary.leagueName,
      season: summary.season,
      status: summary.status,
      inventoryFetched: summary.inventoryFetched,
      finishedCount: summary.finishedCount,
      enriched: summary.enriched,
      skippedFull: summary.skippedFull,
      goalsImported: summary.goalsImported,
      statsImported: summary.statsImported,
      truncated: summary.truncated,
      warning: summary.warning,
      error: summary.error,
      progress: summary.progress,
    })
  );
  const jobs = await histJobsSummary();
  console.log("JOBS_STATUS", JSON.stringify(jobs.byStatus));
  console.log("FIXTURES", jobs.fixtures);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
