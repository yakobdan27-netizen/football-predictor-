/**
 * Quick probe: list missing fixtures + one Stats API discover day.
 * Run: npx tsx scripts/probe-stats-backfill-fill.ts
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
  console.log("ensureSchema…");
  await ensureSchema();
  console.log("read cursor…");
  const { readBackfillCursor, listFinishedFixturesMissingStats } = await import(
    "../lib/live/stats-backfill-store"
  );
  const cursor = await readBackfillCursor();
  console.log("cursor", cursor);
  if (!cursor || cursor.leagueId == null || cursor.season == null) {
    console.log("no fill cell");
    return;
  }
  console.log("list missing…");
  const missing = await listFinishedFixturesMissingStats({
    leagueId: cursor.leagueId,
    season: cursor.season,
    limit: 3,
  });
  console.log(
    "missing",
    missing.map((m) => ({
      id: m.fixtureId,
      kickoff: m.kickoffUtc,
      home: m.homeTeam,
      away: m.awayTeam,
    }))
  );
  const day =
    missing[0]?.kickoffUtc instanceof Date
      ? missing[0].kickoffUtc.toISOString().slice(0, 10)
      : String(missing[0]?.kickoffUtc ?? "").slice(0, 10);
  console.log("discover day", day);
  const { discoverStatsApiMatches, statsApiCompetitionIdForAfLeague } =
    await import("../lib/stats-api");
  const cid = statsApiCompetitionIdForAfLeague(cursor.leagueId);
  const t0 = Date.now();
  const listed = await Promise.race([
    discoverStatsApiMatches({
      dateFrom: day,
      dateTo: day,
      competitionIds: cid ? [cid] : [],
      maxPages: 2,
    }),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("discover timeout 45s")), 45_000)
    ),
  ]);
  console.log(`discover ok in ${Date.now() - t0}ms, n=${listed.length}`);
  console.log(listed.slice(0, 3));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
