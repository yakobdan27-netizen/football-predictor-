/**
 * Same-day catch-up: run several backfill chunks under current package pacing.
 *
 * Usage:
 *   npx tsx scripts/run-stats-backfill-loop.ts
 *   npx tsx scripts/run-stats-backfill-loop.ts --max=8
 *
 * Stops early when phase is done or a hard error occurs.
 * Daily Vercel cron remains the hands-off path.
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
  const maxArg = process.argv.find((a) => a.startsWith("--max="));
  const maxChunks = Math.max(
    1,
    Math.min(50, parseInt(maxArg?.slice(6) ?? "8", 10) || 8)
  );

  const { runStatsBackfillChunk } = await import("../lib/live/stats-backfill");

  console.log(`[stats-backfill-loop] starting, maxChunks=${maxChunks}`);

  for (let i = 1; i <= maxChunks; i++) {
    const started = Date.now();
    console.log(`[stats-backfill-loop] chunk ${i}/${maxChunks}…`);
    const summary = await runStatsBackfillChunk();
    const ms = Date.now() - started;
    const line = JSON.stringify({
      chunk: i,
      ms,
      ok: summary.ok,
      phase: summary.phase,
      cellIndex: summary.cellIndex,
      leagueName: summary.leagueName,
      season: summary.season,
      inventoryFetched: summary.inventoryFetched,
      inventoryUpserted: summary.inventoryUpserted,
      statsFetched: summary.statsFetched,
      missingRemaining: summary.missingRemaining,
      aggregatesTeams: summary.aggregatesTeams,
      done: summary.done ?? false,
      skippedCell: summary.skippedCell ?? false,
      truncated: summary.truncated ?? false,
      warning: summary.warning,
      error: summary.error,
      progress: summary.progress,
    });
    console.log(line);

    if (!summary.ok && summary.error) {
      const transient =
        /fetch failed|Connect Timeout|UND_ERR|NeonDbError|Error connecting/i.test(
          summary.error
        );
      if (transient) {
        console.warn(
          "[stats-backfill-loop] transient error — waiting 8s then continuing"
        );
        await new Promise((r) => setTimeout(r, 8000));
        continue;
      }
      console.error("[stats-backfill-loop] hard error — stopping");
      process.exitCode = 1;
      return;
    }
    if (summary.done) {
      console.log("[stats-backfill-loop] backfill complete (phase=done)");
      return;
    }

    if (i < maxChunks) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log(
    "[stats-backfill-loop] max chunks reached — cron will continue daily"
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
