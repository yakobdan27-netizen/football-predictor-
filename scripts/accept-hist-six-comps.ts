/**
 * Acceptance for 6-competition × 11-season hist backfill.
 * Run: npx tsx scripts/accept-hist-six-comps.ts
 *
 * Note: empty competitions FAIL only when all jobs for that competition are
 * done/skipped (still filling = soft warn).
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

function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function main() {
  console.log("=== Hist six-competition acceptance ===");
  let fails = 0;

  const { getApiFootballKey, apiFootballGet } = await import("../lib/apiClient");
  const { normalizeFootballStatus } = await import("../lib/football-api/status");
  const { confirmLeaguesAndSeason } = await import(
    "../lib/football-api/endpoint-map"
  );
  const { ensureSchema } = await import("../lib/db/init");
  const {
    auditHistCoverage,
    formatCoverageTable,
    hasEmptyCompetition,
  } = await import("../lib/hist/coverage-audit");
  const { HIST_LEAGUES, histJobKeys } = await import("../lib/hist/seasons");
  const { ensureHistJobs, histJobsSummary } = await import("../lib/hist/store");
  const { loadStoredBetas } = await import("../lib/hist/recompute-betas");
  const fs = await import("node:fs");

  try {
    getApiFootballKey();
    const raw = await apiFootballGet<unknown>("/status");
    const st = normalizeFootballStatus(raw);
    const remaining =
      st.requests?.remaining ??
      (st.requests?.limitDay != null && st.requests?.current != null
        ? Math.max(0, st.requests.limitDay - st.requests.current)
        : null);
    if (
      !check(
        "/status plan + quota printed",
        !!st.plan && remaining != null,
        `plan=${st.plan} remaining=${remaining}`
      )
    ) {
      fails += 1;
    }
  } catch (e) {
    check("/status plan + quota printed", false, String(e));
    fails += 1;
  }

  if (!check("HIST_LEAGUES has 6 competitions", HIST_LEAGUES.length === 6)) {
    fails += 1;
  }
  if (
    !check(
      "UCL id=2 cup in HIST_LEAGUES",
      HIST_LEAGUES.some((l) => l.id === 2 && l.type === "cup")
    )
  ) {
    fails += 1;
  }

  const confirm = await confirmLeaguesAndSeason();
  const okIds = new Set(
    confirm.leagues.filter((l) => l.ok).map((l) => l.expectedId)
  );
  const need = [39, 140, 135, 78, 61, 2];
  const allOk = need.every((id) => okIds.has(id));
  if (
    !check(
      "six competition IDs resolve via /leagues",
      allOk,
      confirm.leagues.map((l) => `${l.expectedId}:${l.ok ? "ok" : "fail"}`).join(", ")
    )
  ) {
    fails += 1;
  }

  await ensureSchema();
  await ensureHistJobs();
  const jobs = await histJobsSummary();
  const expectedJobs = histJobKeys().length;
  if (
    !check(
      "hist_jobs seeded for all competition×season",
      jobs.jobs.length >= expectedJobs,
      `jobs=${jobs.jobs.length} expected>=${expectedJobs} byStatus=${JSON.stringify(jobs.byStatus)}`
    )
  ) {
    fails += 1;
  }

  const coverage = await auditHistCoverage();
  console.log(formatCoverageTable(coverage));
  if (
    !check(
      "coverage buckets = 6×11",
      coverage.summary.total === 66,
      `total=${coverage.summary.total}`
    )
  ) {
    fails += 1;
  }

  const allTerminal = jobs.jobs.every(
    (j) => j.status === "done" || j.status === "skipped"
  );
  if (allTerminal && hasEmptyCompetition(coverage)) {
    if (
      !check(
        "no empty competition when all jobs terminal",
        false,
        coverage.perCompetition
          .filter((c) => c.stored === 0)
          .map((c) => c.leagueName)
          .join(", ")
      )
    ) {
      fails += 1;
    }
  } else if (hasEmptyCompetition(coverage)) {
    console.log(
      "WARN empty competition while jobs still pending/in_progress — keep draining backfill"
    );
    for (const c of coverage.perCompetition) {
      console.log(
        `  ${c.leagueName}: fixtures=${c.stored} ht=${c.withHt} corners=${c.withCorners}`
      );
    }
  } else {
    check("per-competition fixture counts non-zero", true);
  }

  const betas = await loadStoredBetas();
  const domesticNames = HIST_LEAGUES.filter((l) => l.type === "league").map(
    (l) => l.name
  );
  const betaKeys = domesticNames.filter((n) => typeof betas[n] === "number");
  check(
    "BETA_2H stored for domestic leagues (recompute after fill)",
    betaKeys.length > 0,
    `have=${betaKeys.join(",") || "none"}`
  );

  const histStore = fs.readFileSync(
    resolve(process.cwd(), "lib/hist/store.ts"),
    "utf8"
  );
  const histImport = fs.readFileSync(
    resolve(process.cwd(), "lib/hist/import-job.ts"),
    "utf8"
  );
  if (
    !check(
      "hist writers isolated from prediction-log / bet_ / live_ writers",
      !/prediction-log\/storage|manual-results|betSlips|from \"@\/lib\/live\/store\"/.test(
        histStore
      ) && !/prediction-log\/storage|manual-results/.test(histImport)
    )
  ) {
    fails += 1;
  }

  console.log(
    fails === 0
      ? "Six-comp acceptance: ALL HARD CHECKS PASSED (drain UCL jobs + recompute as needed)"
      : `Six-comp acceptance: ${fails} FAIL(s)`
  );
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
