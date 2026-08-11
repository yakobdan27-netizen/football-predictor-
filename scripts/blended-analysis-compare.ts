/**
 * Comparison report: legacy vs API-only vs system-only vs blended.
 * Run: npx tsx scripts/blended-analysis-compare.ts
 * Does not enable the feature flag globally.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { weightedEstimate } from "../lib/prediction-log/prediction-weights";
import { blendNumericKpi } from "../lib/analysis/blend-math";
import { getBlendConfig } from "../lib/analysis/blend-config";
import { buildBlendedAnalysisResult } from "../lib/analysis/blended-analysis-service";

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

type Case = {
  name: string;
  api: number | null;
  system: number | null;
  apiN: number;
  systemN: number;
};

const CASES: Case[] = [
  { name: "both sides", api: 1.4, system: 1.1, apiN: 20, systemN: 12 },
  { name: "API only", api: 1.4, system: null, apiN: 20, systemN: 0 },
  { name: "system only", api: null, system: 1.1, apiN: 0, systemN: 12 },
  { name: "empty", api: null, system: null, apiN: 0, systemN: 0 },
  { name: "below min system", api: 1.4, system: 1.1, apiN: 20, systemN: 2 },
  { name: "duplicate-ish equal", api: 2, system: 2, apiN: 10, systemN: 10 },
];

function main() {
  const config = getBlendConfig();
  const prev = process.env.ANALYSIS_BLENDED_MODE_ENABLED;
  process.env.ANALYSIS_BLENDED_MODE_ENABLED = "1";

  const lines: string[] = [];
  const date = new Date().toISOString().slice(0, 10);
  lines.push(`# Blended analysis comparison (${date})`);
  lines.push("");
  lines.push(
    "Synthetic KPI cases (λ-like). Review before setting `ANALYSIS_BLENDED_MODE_ENABLED=true`."
  );
  lines.push("");
  lines.push(
    `| Case | Legacy weightedEstimate | API-only | System-only | Blended value | Status | Eff API | Eff Sys | Warnings |`
  );
  lines.push("|---|---|---|---|---|---|---|---|---|");

  for (const c of CASES) {
    const legacy = weightedEstimate(c.api, c.system);
    const numeric = blendNumericKpi(c.api, c.system, config, {
      apiRecordCount: c.apiN,
      systemRecordCount: c.systemN,
      minApiRecords: config.minApiRecords,
      minSystemRecords: config.minSystemRecords,
    });
    const wrapped = buildBlendedAnalysisResult<
      { legacy: number | null },
      { x: number }
    >({
      legacy: { legacy: legacy?.value ?? null },
      metrics: [{ key: "x", api: c.api, system: c.system }],
      apiSummary: {
        recordCount: c.apiN,
        dateRange: { from: "2015-08-01", to: "2026-05-01" },
        byProvenance: { api_historical: c.apiN },
        excludedUnknown: 0,
      },
      systemSummary: {
        recordCount: c.systemN,
        dateRange: { from: "2024-01-01", to: "2026-05-01" },
        byProvenance: { manual_batch: c.systemN },
        excludedUnknown: 0,
      },
      config,
    });

    lines.push(
      `| ${c.name} | ${legacy?.value ?? "—"} (${legacy?.source ?? "null"}) | ${c.api ?? "—"} | ${c.system ?? "—"} | ${wrapped.blended.metrics.x ?? "—"} | ${wrapped.blended.status} | ${wrapped.blended.sourceBreakdown.api.effectiveWeight} | ${wrapped.blended.sourceBreakdown.system.effectiveWeight} | ${wrapped.blended.quality.warnings.join("; ") || "—"} |`
    );
    void numeric;
  }

  lines.push("");
  lines.push("## Config");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(config, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- Flag was forced on for this script only; production default remains off."
  );
  lines.push(
    "- Missing side is never treated as zero under `fallbackMode=legacy`."
  );
  lines.push("");

  if (prev == null) delete process.env.ANALYSIS_BLENDED_MODE_ENABLED;
  else process.env.ANALYSIS_BLENDED_MODE_ENABLED = prev;

  const dir = join(process.cwd(), "docs", "reports");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `blended-analysis-compare-${date}.md`);
  writeFileSync(out, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log(`Wrote ${out}`);
}

main();
