/**
 * Phase 3: recompute BETA_2H + league priors + persist team_half_stats.
 * Run: npx tsx scripts/recompute-hist-model-inputs.ts
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
  console.log("=== Phase 3 — Derive model inputs ===");
  const { ensureSchema } = await import("../lib/db/init");
  const { recomputeLeagueBetas } = await import("../lib/hist/recompute-betas");
  const { recomputeLeaguePriors } = await import("../lib/hist/league-priors");
  const { persistTeamHalfStatsFromHist } = await import(
    "../lib/hist/persist-team-half-stats"
  );

  await ensureSchema();
  const betas = await recomputeLeagueBetas();
  console.log("BETA_2H changes:");
  for (const c of betas.changes) {
    console.log(`  ${c.league}: ${c.old.toFixed(3)} → ${c.new.toFixed(3)}`);
  }
  const priors = await recomputeLeaguePriors();
  console.log("League priors (goals/game):");
  for (const p of priors.priors) {
    console.log(
      `  ${p.league}: gpg=${p.goalsPerGame.toFixed(3)} n=${p.n} O2.5=${p.over25Rate?.toFixed(3) ?? "NULL"} BTTS=${p.bttsRate?.toFixed(3) ?? "NULL"}`
    );
  }
  const half = await persistTeamHalfStatsFromHist();
  console.log(
    `team_half_stats: written=${half.written} teams=${half.teams} thin_data_rows=${half.thinData}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
