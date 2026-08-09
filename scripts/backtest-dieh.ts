/**
 * DIEH held-out calibration (last 2 seasons).
 * Run: npx tsx scripts/backtest-dieh.ts
 *
 * Uses league-mean FT λ as a stand-in when per-fixture CFE λ is unavailable offline.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { and, gte, eq, isNotNull, sql } from "drizzle-orm";

function loadEnvFile(name: string) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
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
  const { getDb } = await import("../lib/db");
  const { histFixtures } = await import("../lib/db/schema");
  const { HIST_LEAGUES, currentHistSeason, histWindowMinSeason } = await import(
    "../lib/hist/seasons"
  );
  const { backtestDiehOnRows, formatCalibrationTable } = await import(
    "../lib/prediction-log/dieh-calibration"
  );

  await ensureSchema();
  const db = await getDb();
  const current = currentHistSeason();
  const minSeason = histWindowMinSeason();
  const heldOut = [current - 2, current - 1];

  for (const league of HIST_LEAGUES) {
    const rows = await db
      .select({
        fixtureId: histFixtures.fixtureId,
        season: histFixtures.season,
        htHome: histFixtures.htHome,
        htAway: histFixtures.htAway,
        ftHome: histFixtures.ftHome,
        ftAway: histFixtures.ftAway,
      })
      .from(histFixtures)
      .where(
        and(
          eq(histFixtures.leagueId, league.id),
          gte(histFixtures.season, minSeason),
          isNotNull(histFixtures.htHome),
          isNotNull(histFixtures.htAway),
          isNotNull(histFixtures.ftHome),
          isNotNull(histFixtures.ftAway),
          sql`${histFixtures.status} in ('FT','AET','PEN')`
        )
      );

    const full = rows
      .filter(
        (r) =>
          r.htHome != null &&
          r.htAway != null &&
          r.ftHome != null &&
          r.ftAway != null
      )
      .map((r) => ({
        fixtureId: r.fixtureId,
        season: r.season,
        htHome: r.htHome!,
        htAway: r.htAway!,
        ftHome: r.ftHome!,
        ftAway: r.ftAway!,
      }));

    const trainRows = full.filter((r) => !heldOut.includes(r.season));
    const testBase = full.filter((r) => heldOut.includes(r.season));
    if (trainRows.length < 50 || testBase.length < 20) {
      console.log(
        `${league.name}: skip (train=${trainRows.length} test=${testBase.length})`
      );
      continue;
    }

    const meanH =
      trainRows.reduce((s, r) => s + r.ftHome, 0) / trainRows.length;
    const meanA =
      trainRows.reduce((s, r) => s + r.ftAway, 0) / trainRows.length;

    const report = backtestDiehOnRows({
      trainRows,
      testRows: testBase.map((r) => ({
        ...r,
        lambdaHome: meanH,
        lambdaAway: meanA,
      })),
      leagueId: league.id,
      leagueName: league.name,
      compType: league.type,
      currentSeason: current,
      heldOutSeasons: heldOut,
    });

    console.log(`\n=== ${league.name} ===`);
    console.log(
      `n=${report.n} trainN=${report.trainN} Brier=${report.brier.toFixed(4)}`
    );
    console.table(formatCalibrationTable(report));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
