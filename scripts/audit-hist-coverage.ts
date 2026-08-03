/**
 * Phase 1: print hist coverage audit (read-only).
 * Run: npx tsx scripts/audit-hist-coverage.ts
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
  const { auditHistCoverage, formatCoverageTable } = await import(
    "../lib/hist/coverage-audit"
  );
  console.log("=== Phase 1 — Hist coverage audit (read-only) ===");
  await ensureSchema();
  const report = await auditHistCoverage();
  console.log(formatCoverageTable(report));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
