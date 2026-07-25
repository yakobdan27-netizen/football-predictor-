/**
 * Verify API-Football key + x-apisports-key header locally.
 * Run: npx tsx scripts/verify-api-football.ts
 *
 * Loads .env.local / .env if present (never commit keys).
 * Accepts APISPORTS_KEY or legacy API_FOOTBALL_KEY.
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

type StatusAccount = {
  firstname?: string;
  lastname?: string;
  email?: string;
};

type StatusSubscription = {
  plan?: string;
  end?: string;
  active?: boolean;
};

type StatusRequests = {
  current?: number;
  limit_day?: number;
};

type StatusPayload = {
  account?: StatusAccount;
  subscription?: StatusSubscription;
  requests?: StatusRequests;
};

async function main() {
  const { apiFootballGet, getApiFootballKey, getApiFootballBaseUrl } = await import(
    "../lib/football-api/client"
  );
  try {
    const key = getApiFootballKey();
    const source = (process.env.APISPORTS_KEY ?? "").trim()
      ? "APISPORTS_KEY"
      : "API_FOOTBALL_KEY";
    console.log("Base URL:", getApiFootballBaseUrl());
    console.log("Key source:", source);
    console.log("Key present:", key.slice(0, 4) + "…");
    const status = (await apiFootballGet<StatusPayload>("/status")) as StatusPayload;
    const plan = status?.subscription?.plan ?? "(unknown)";
    const current = status?.requests?.current;
    const limit = status?.requests?.limit_day;
    const remaining =
      typeof current === "number" && typeof limit === "number"
        ? Math.max(0, limit - current)
        : null;
    console.log("KEY WORKS.");
    console.log("Plan:", plan);
    console.log(
      "Requests:",
      current != null && limit != null
        ? `${current} / ${limit} (remaining ${remaining})`
        : JSON.stringify(status?.requests ?? null)
    );
    console.log("Raw status:", JSON.stringify(status, null, 2));
  } catch (e) {
    console.error("KEY FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}

void main();
