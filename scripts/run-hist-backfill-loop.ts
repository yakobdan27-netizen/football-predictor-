/**
 * Local drain loop for hist_* backfill chunks.
 *
 * Usage:
 *   npx tsx scripts/run-hist-backfill-loop.ts
 *   npx tsx scripts/run-hist-backfill-loop.ts --max=8
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

  const { runHistBackfillChunk } = await import("../lib/hist/backfill");

  console.log(`[hist-backfill-loop] starting, maxChunks=${maxChunks}`);

  for (let i = 1; i <= maxChunks; i++) {
    const started = Date.now();
    console.log(`[hist-backfill-loop] chunk ${i}/${maxChunks}…`);
    const summary = await runHistBackfillChunk();
    const ms = Date.now() - started;
    console.log(
      JSON.stringify({
        chunk: i,
        ms,
        ok: summary.ok,
        leagueName: summary.leagueName,
        season: summary.season,
        status: summary.status,
        enriched: summary.enriched,
        skippedFull: summary.skippedFull,
        truncated: summary.truncated,
        quotaAbort: summary.quotaAbort,
        done: summary.done,
        allJobsTerminal: summary.allJobsTerminal,
        progress: summary.progress,
        warning: summary.warning,
        error: summary.error,
        plan: summary.preflight.plan,
        remaining: summary.preflight.remaining,
      })
    );

    if (!summary.ok && summary.error) {
      if (/quota|safety margin/i.test(summary.error)) {
        console.warn("[hist-backfill-loop] quota gate — stopping for today");
        return;
      }
      const transient =
        /fetch failed|Connect Timeout|UND_ERR|NeonDbError|Error connecting/i.test(
          summary.error
        );
      if (transient) {
        console.warn(
          "[hist-backfill-loop] transient error — waiting 8s then continuing"
        );
        await new Promise((r) => setTimeout(r, 8000));
        continue;
      }
      console.error("[hist-backfill-loop] hard error — stopping");
      process.exitCode = 1;
      return;
    }
    if (summary.done || summary.allJobsTerminal) {
      console.log("[hist-backfill-loop] all jobs terminal");
      return;
    }
    if (i < maxChunks) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log(
    "[hist-backfill-loop] max chunks reached — cron will continue nightly"
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
