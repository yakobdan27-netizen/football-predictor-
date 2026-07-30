/**
 * Print backfill cursor + progress (direct DB, no HTTP).
 * Run: npx tsx scripts/print-stats-backfill-status.ts
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
  const { ensureSchema } = await import("../lib/db/init");
  await ensureSchema();
  const { readBackfillCursor, countBackfillProgress } = await import(
    "../lib/live/stats-backfill-store"
  );
  const { backfillCellAt, STATS_BACKFILL_LEAGUES, STATS_BACKFILL_SEASONS } =
    await import("../lib/live/stats-backfill-constants");

  const cursor = await readBackfillCursor();
  const progress = await countBackfillProgress();
  const cell =
    cursor != null ? backfillCellAt(cursor.cellIndex) : backfillCellAt(0);

  console.log(
    JSON.stringify(
      {
        done: cursor?.phase === "done",
        cursor,
        cell,
        totalCells:
          STATS_BACKFILL_LEAGUES.length * STATS_BACKFILL_SEASONS.length,
        progress,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
