/**
 * Hist → core_* backfill CLI.
 * Run: npx tsx scripts/core-backfill.ts --dry-run
 *      npx tsx scripts/core-backfill.ts --limit 500
 */
import { existsSync, readFileSync } from "node:fs";
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

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const skipKv = argv.includes("--skip-kv");
  let limit = 0;
  const li = argv.indexOf("--limit");
  if (li >= 0 && argv[li + 1]) limit = parseInt(argv[li + 1]!, 10) || 0;
  return { dryRun, limit, skipKv };
}

async function main() {
  const { dryRun, limit, skipKv } = parseArgs(process.argv.slice(2));
  const { ensureSchema } = await import("../lib/db/init");
  const { backfillFromHist, countCoreTables } = await import(
    "../lib/core/backfill-from-hist"
  );

  console.log("=== core backfill from hist_* ===");
  console.log(`dryRun=${dryRun} limit=${limit || "all"} skipKv=${skipKv}`);
  await ensureSchema();

  const report = await backfillFromHist({
    dryRun,
    limit,
    skipKvTraces: skipKv,
  });
  console.log(JSON.stringify(report, null, 2));

  if (!dryRun) {
    const counts = await countCoreTables();
    console.log("core table counts:", counts);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
