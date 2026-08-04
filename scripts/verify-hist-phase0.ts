/**
 * Phase 0 preconditions: API key, /status quota, Big-5 league IDs, 11 completed seasons.
 * Run: npx tsx scripts/verify-hist-phase0.ts
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

const EXPECTED: Array<{ name: string; id: number }> = [
  { name: "Premier League", id: 39 },
  { name: "La Liga", id: 140 },
  { name: "Serie A", id: 135 },
  { name: "Bundesliga", id: 78 },
  { name: "Ligue 1", id: 61 },
];

async function main() {
  const { getApiFootballKey } = await import("../lib/apiClient");
  const { confirmLeaguesAndSeason } = await import(
    "../lib/football-api/endpoint-map"
  );
  const { histSeasonYears } = await import("../lib/hist/seasons");
  const { normalizeFootballStatus } = await import(
    "../lib/football-api/status"
  );
  const { apiFootballGet } = await import("../lib/football-api/client");

  console.log("=== Phase 0 — Preconditions ===");

  try {
    getApiFootballKey();
    console.log("PASS key: APISPORTS_KEY (or API_FOOTBALL_KEY) loaded");
  } catch (e) {
    console.error(
      "FAIL key:",
      e instanceof Error ? e.message : "missing key"
    );
    process.exit(1);
  }

  let plan = "(unknown)";
  let remaining: number | null = null;
  try {
    const raw = await apiFootballGet<unknown>("/status");
    const st = normalizeFootballStatus(raw);
    plan = st.plan ?? "(unknown)";
    remaining =
      st.requests?.remaining ??
      (st.requests?.limitDay != null && st.requests?.current != null
        ? Math.max(0, st.requests.limitDay - st.requests.current)
        : null);
    console.log(`PASS status: plan=${plan} remaining=${remaining ?? "?"}`);
    if (!st.plan || /invalid|error/i.test(String(st.plan))) {
      console.error("FAIL status: invalid plan");
      process.exit(1);
    }
  } catch (e) {
    console.error(
      "FAIL status:",
      e instanceof Error ? e.message : String(e)
    );
    process.exit(1);
  }

  const confirm = await confirmLeaguesAndSeason();
  let leagueFail = 0;
  for (const exp of EXPECTED) {
    const row = confirm.leagues.find((l) => l.expectedId === exp.id);
    const resolved = row?.apiName ?? row?.name ?? "(missing)";
    const ok = row?.ok === true;
    const nameOk =
      !row?.apiName ||
      row.apiName.toLowerCase().includes(
        exp.name.split(" ")[0]!.toLowerCase()
      ) ||
      (exp.name === "Premier League" &&
        /premier|epl/i.test(row.apiName ?? ""));
    if (ok && nameOk) {
      console.log(`PASS league ${exp.id}: ${resolved}`);
    } else {
      leagueFail += 1;
      console.error(
        `FAIL league ${exp.id}: expected ${exp.name}, got ${resolved} ok=${row?.ok}`
      );
    }
  }
  if (leagueFail > 0) {
    console.error(`FAIL leagues: ${leagueFail} mismatches`);
    process.exit(1);
  }

  const seasons = histSeasonYears({ includeCurrent: false });
  console.log(`PASS seasons (11 completed): ${seasons.join(", ")}`);
  if (seasons.length !== 11) {
    console.error(`FAIL seasons: expected 11, got ${seasons.length}`);
    process.exit(1);
  }

  console.log(
    `Phase 0 summary: PASS plan=${plan} remaining=${remaining ?? "?"} leagues=5/5 seasons=${seasons.length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
