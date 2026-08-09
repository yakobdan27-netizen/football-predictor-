/**
 * Trigger production hist cron once (same as Vercel scheduled slot).
 * Requires CRON_SECRET in .env.local
 * Run: npx tsx scripts/trigger-prod-hist-cron.ts
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

const BASE =
  process.env.VERCEL_URL?.startsWith("http")
    ? process.env.VERCEL_URL
    : "https://football-predictor-app-two.vercel.app";

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET missing in .env.local");
    process.exit(1);
  }
  const url = `${BASE.replace(/\/$/, "")}/api/cron/hist-backfill`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });
  const text = await res.text();
  console.log(`status=${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
  if (!res.ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
