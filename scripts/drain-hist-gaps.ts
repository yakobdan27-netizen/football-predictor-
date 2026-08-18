/**
 * Local burst drain for hist coverage gaps (complements daily Vercel cron).
 * Cron default: /api/cron/hist-backfill several times/day with gapPriority.
 * Run: npx tsx scripts/drain-hist-gaps.ts [--max-chunks=200] [--enrich=50] [--league=140] [--mode=inventory|enrichment|auto]
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

function argStr(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  if (!hit) return undefined;
  const val = hit.slice(name.length + 1).trim();
  return val || undefined;
}

async function resolveLeagueId(raw?: string): Promise<number | undefined> {
  if (!raw) return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const { HIST_LEAGUES } = await import("../lib/hist/seasons");
  const hit = HIST_LEAGUES.find(
    (l) => l.name.toLowerCase() === raw.toLowerCase()
  );
  if (!hit) {
    console.error(`Unknown league "${raw}" — use API id or HIST_LEAGUES name`);
    process.exit(1);
  }
  return hit.id;
}

type DrainMode = "inventory" | "enrichment" | "auto";

function resolveMode(raw?: string): DrainMode {
  if (!raw || raw === "auto") return "auto";
  if (raw === "inventory" || raw === "enrichment") return raw;
  console.error(`Unknown --mode=${raw} — use inventory, enrichment, or auto`);
  process.exit(1);
}

async function main() {
  const maxChunks = argNum("--max-chunks", 200);
  const enrich = argNum("--enrich", 50);
  const leagueId = await resolveLeagueId(argStr("--league"));
  const modeArg = resolveMode(argStr("--mode"));
  process.env.HIST_MAX_ENRICH_PER_CHUNK = String(enrich);

  const { ensureSchema } = await import("../lib/db/init");
  const {
    auditHistCoverage,
    formatCoverageTable,
    gapQueueFromCoverage,
    enrichmentGapQueueFromCoverage,
  } = await import("../lib/hist/coverage-audit");
  const { runHistBackfillChunk } = await import("../lib/hist/backfill");
  const { HIST_LEAGUES } = await import("../lib/hist/seasons");

  await ensureSchema();
  let before = await auditHistCoverage();
  const passCount = (r: typeof before) =>
    r.buckets.filter((b) => b.inventoryPass).length;

  const leagueLabel =
    leagueId != null
      ? (HIST_LEAGUES.find((l) => l.id === leagueId)?.name ?? `id=${leagueId}`)
      : null;

  function pickPhase(): "inventory" | "enrichment" {
    if (modeArg === "inventory") return "inventory";
    if (modeArg === "enrichment") return "enrichment";
    const invPass = passCount(before) >= before.summary.total;
    const invGaps = gapQueueFromCoverage(before).filter(
      (g) => leagueId == null || g.leagueId === leagueId
    ).length;
    const enrichGaps = enrichmentGapQueueFromCoverage(before).filter(
      (g) => leagueId == null || g.leagueId === leagueId
    ).length;
    if (!invPass && invGaps > 0) return "inventory";
    if (enrichGaps > 0) return "enrichment";
    return invPass ? "enrichment" : "inventory";
  }

  let phase = pickPhase();

  console.log(`=== Drain hist gaps (${phase} mode) ===`);
  if (leagueLabel) {
    console.log(`league filter: ${leagueLabel} (${leagueId})`);
  }
  console.log(
    `start: full=${before.summary.full} partial=${before.summary.partial} missing=${before.summary.missing} inventoryPass=${passCount(before)}/66 providerHoles=${before.summary.providerHoles} enrich/chunk=${enrich} mode=${modeArg}`
  );
  const allQueued =
    phase === "enrichment"
      ? enrichmentGapQueueFromCoverage(before)
      : gapQueueFromCoverage(before);
  const queued =
    leagueId != null
      ? allQueued.filter((g) => g.leagueId === leagueId)
      : allQueued;
  console.log(
    `${phase} gaps queued: ${queued.length}${leagueLabel ? ` (${leagueLabel} only)` : ""}`
  );
  console.log(
    "next:",
    queued
      .slice(0, 8)
      .map(
        (g) =>
          `${g.leagueName} ${g.season} ${g.stored_fixtures}/${g.expected_fixtures} pass=${g.inventoryPass} htMiss=${g.htMissingPct ?? "?"}% cornersMiss=${g.cornersMissingPct ?? "?"}%`
      )
      .join(" | ")
  );

  let consecutiveSkips = 0;
  let totalEnriched = 0;
  let totalHtFilled = 0;
  let totalCornersFilled = 0;
  let neonRetries = 0;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < maxChunks; i++) {
    before = await auditHistCoverage().catch(() => before);
    phase = pickPhase();

    let summary: Awaited<ReturnType<typeof runHistBackfillChunk>>;
    try {
      summary = await runHistBackfillChunk({
        gapPriority: true,
        leagueId,
        mode: phase,
      });
      neonRetries = 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const transient =
        /fetch failed|ECONNRESET|Connect Timeout|NeonDbError|UND_ERR/i.test(
          msg
        ) ||
        (e != null &&
          typeof e === "object" &&
          "sourceError" in e);
      if (transient && neonRetries < 8) {
        neonRetries += 1;
        const wait = Math.min(60_000, 3000 * neonRetries);
        console.log(
          `transient DB/network error (retry ${neonRetries}/8 in ${wait}ms): ${msg}`
        );
        await sleep(wait);
        i -= 1;
        continue;
      }
      throw e;
    }

    totalEnriched += summary.enriched;
    totalHtFilled += summary.htFilled;
    totalCornersFilled += summary.cornersFilled;
    console.log(
      `chunk ${i + 1}/${maxChunks} [${phase}]: ok=${summary.ok} ${summary.leagueName ?? "-"} ${summary.season ?? ""} enriched=${summary.enriched} ht=${summary.htFilled} corners=${summary.cornersFilled} gapsLeft=${summary.gapsRemaining ?? "?"} enrichGaps=${summary.enrichmentGapsRemaining ?? "?"} quotaAbort=${summary.quotaAbort} skipped=${summary.skippedJob} warn=${summary.warning ?? ""} err=${summary.error ?? ""}`
    );

    if (summary.quotaAbort || summary.preflight.abort) {
      console.log("STOP: quota/safety abort");
      break;
    }
    if (!summary.ok) {
      neonRetries += 1;
      if (neonRetries <= 12) {
        const wait = Math.min(90_000, 4000 * neonRetries);
        console.log(
          `chunk ok=false (retry ${neonRetries}/12 in ${wait}ms): ${summary.error ?? "unknown"}`
        );
        await sleep(wait);
        i -= 1;
        continue;
      }
      consecutiveSkips += 1;
      neonRetries = 0;
      if (consecutiveSkips >= 20) {
        console.log("STOP: too many hard chunk failures");
        break;
      }
      continue;
    }
    neonRetries = 0;
    if (summary.skippedJob && summary.enriched === 0) {
      consecutiveSkips += 1;
      if (consecutiveSkips >= 40) {
        console.log(
          "STOP: too many skipped jobs (likely provider holes) — audit remaining gaps"
        );
        break;
      }
    } else {
      consecutiveSkips = 0;
    }
    if (summary.done) {
      console.log(`STOP: ${phase} queue reports done`);
      if (modeArg === "auto") {
        const invPass = passCount(before) >= before.summary.total;
        const enrichLeft = enrichmentGapQueueFromCoverage(before).filter(
          (g) => leagueId == null || g.leagueId === leagueId
        ).length;
        if (phase === "inventory" && invPass && enrichLeft > 0) {
          console.log(`Switching to enrichment (${enrichLeft} gaps)`);
          continue;
        }
      }
      break;
    }

    if ((i + 1) % 5 === 0) {
      for (let a = 0; a < 5; a++) {
        try {
          before = await auditHistCoverage();
          break;
        } catch {
          await sleep(2000 * (a + 1));
        }
      }
      const pass = passCount(before);
      const enrichLeft = enrichmentGapQueueFromCoverage(before).length;
      console.log(
        `checkpoint: full=${before.summary.full} inventoryPass=${pass}/66 holes=${before.summary.providerHoles} enrichGaps=${enrichLeft} enrichedTotal=${totalEnriched} ht=${totalHtFilled} corners=${totalCornersFilled}`
      );
      if (modeArg !== "enrichment" && pass === 66 && enrichLeft > 0) {
        console.log(`GATE PASS — ${enrichLeft} enrichment gaps remain`);
        if (modeArg === "auto") {
          phase = "enrichment";
        }
      }
    }
  }

  const after = await auditHistCoverage();
  console.log("--- AFTER ---");
  console.log(formatCoverageTable(after));
  const inv = passCount(after);
  const enrichLeft = enrichmentGapQueueFromCoverage(after).length;
  console.log(
    `inventoryPass=${inv}/66 full=${after.summary.full} partial=${after.summary.partial} missing=${after.summary.missing} providerHoles=${after.summary.providerHoles} enrichGaps=${enrichLeft} enrichedTotal=${totalEnriched} ht=${totalHtFilled} corners=${totalCornersFilled}`
  );

  if (totalEnriched > 0 || inv > passCount(before)) {
    try {
      const { fitAndPersistHalfParams } = await import("../lib/hist/fit-half-params");
      console.log("--- FIT HALF PARAMS (DIEH) ---");
      const rows = await fitAndPersistHalfParams();
      for (const r of rows) {
        console.log(
          `${r.leagueName} (${r.compType}): n=${r.nValid} s1=${r.s1.toFixed(3)} κ_adj=${r.kappaAdj.toFixed(3)} goals=${r.goalsDistribution}`
        );
      }
    } catch (e) {
      console.warn(
        "half-params refit failed:",
        e instanceof Error ? e.message : e
      );
    }
  } else {
    console.log("skip half-params refit (no new enrichments)");
  }

  if (modeArg === "inventory" && inv < 66) {
    process.exitCode = 2;
  } else if (modeArg === "enrichment" && enrichLeft > 0) {
    process.exitCode = 2;
  } else if (modeArg === "auto" && (inv < 66 || enrichLeft > 0)) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
