/**
 * Gap-priority hist backfill loop (quota-aware).
 * Run: npx tsx scripts/run-hist-gap-backfill.ts [--max-chunks=5]
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
  const maxArg = process.argv.find((a) => a.startsWith("--max-chunks="));
  const maxChunks = maxArg ? Number(maxArg.split("=")[1]) || 5 : 5;

  const { ensureSchema } = await import("../lib/db/init");
  const {
    auditHistCoverage,
    formatCoverageTable,
    gapQueueFromCoverage,
  } = await import("../lib/hist/coverage-audit");
  const { runHistBackfillChunk } = await import("../lib/hist/backfill");

  console.log("=== Phase 2 — Gap-priority backfill ===");
  await ensureSchema();
  const before = await auditHistCoverage();
  console.log("--- BEFORE ---");
  console.log(formatCoverageTable(before));
  console.log(`Gaps queued: ${gapQueueFromCoverage(before).length}`);

  for (let i = 0; i < maxChunks; i++) {
    const summary = await runHistBackfillChunk({ gapPriority: true });
    console.log(
      `chunk ${i + 1}/${maxChunks}: ok=${summary.ok} ${summary.leagueName ?? "-"} ${summary.season ?? ""} enriched=${summary.enriched} gapsLeft=${summary.gapsRemaining ?? "?"} quotaAbort=${summary.quotaAbort}`
    );
    if (!summary.ok || summary.quotaAbort || summary.done) break;
  }

  const after = await auditHistCoverage();
  console.log("--- AFTER ---");
  console.log(formatCoverageTable(after));
  console.log(
    `Delta full: ${before.summary.full} → ${after.summary.full}; missing: ${before.summary.missing} → ${after.summary.missing}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
