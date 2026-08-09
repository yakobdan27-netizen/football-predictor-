/**
 * Local equivalent of /api/cron/hist-backfill (gap-priority daily drain).
 * Run: npx tsx scripts/run-daily-drain.ts [--max-chunks=5]
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

function argNum(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main() {
  const maxChunks = argNum("--max-chunks", 1);
  const { ensureSchema } = await import("../lib/db/init");
  const { runDailyHistDrain } = await import("../lib/hist/daily-drain");
  await ensureSchema();
  const result = await runDailyHistDrain({ maxChunks });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && result.stoppedReason === "error") {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
