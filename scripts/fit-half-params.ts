/**
 * Fit half shares + DIEH κ; persist to hist_league_half_params.
 * Run: npx tsx scripts/fit-half-params.ts
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
  const { fitAndPersistHalfParams } = await import(
    "../lib/hist/fit-half-params"
  );
  await ensureSchema();
  const rows = await fitAndPersistHalfParams();
  console.log(
    JSON.stringify(
      rows.map((r) => ({
        league: r.leagueName,
        compType: r.compType,
        nValid: r.nValid,
        s1: r.s1,
        s1Home: r.s1Home,
        s1Away: r.s1Away,
        kappaAdj: r.kappaAdj,
        goalsDistribution: r.goalsDistribution,
        goalsDispersion: r.goalsDispersion,
      })),
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
