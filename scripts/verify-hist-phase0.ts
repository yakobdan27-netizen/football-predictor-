/**
 * Phase 0 preconditions: API key, /status quota, six competition IDs, 11 completed seasons.
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

const EXPECTED: Array<{ name: string; id: number; type: string }> = [
  { name: "Premier League", id: 39, type: "league" },
  { name: "La Liga", id: 140, type: "league" },
  { name: "Serie A", id: 135, type: "league" },
  { name: "Bundesliga", id: 78, type: "league" },
  { name: "Ligue 1", id: 61, type: "league" },
  { name: "UEFA Champions League", id: 2, type: "cup" },
];

async function main() {
  const { getApiFootballKey } = await import("../lib/apiClient");
  const { confirmLeaguesAndSeason } = await import(
    "../lib/football-api/endpoint-map"
  );
  const { histSeasonYears, HIST_LEAGUES, histJobKeys } = await import(
    "../lib/hist/seasons"
  );
  const { normalizeFootballStatus } = await import(
    "../lib/football-api/status"
  );
  const { apiFootballGet } = await import("../lib/football-api/client");

  console.log("=== Phase 0 — Preconditions (6 competitions) ===");

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

  if (HIST_LEAGUES.length !== 6) {
    console.error(`FAIL HIST_LEAGUES length: expected 6, got ${HIST_LEAGUES.length}`);
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
        /premier|epl/i.test(row.apiName ?? "")) ||
      (exp.name === "UEFA Champions League" &&
        /champion/i.test(row.apiName ?? ""));
    if (ok && nameOk) {
      console.log(`PASS league ${exp.id} (${exp.type}): ${resolved}`);
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

  const keys = histJobKeys();
  console.log(
    `PASS job keys: ${keys.length} (expect 6×12=${6 * 12} with current)`
  );
  if (keys.length !== 72) {
    console.error(`FAIL job keys: expected 72, got ${keys.length}`);
    process.exit(1);
  }

  console.log(
    `Phase 0 summary: PASS plan=${plan} remaining=${remaining ?? "?"} leagues=6/6 seasons=${seasons.length} jobs=${keys.length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
