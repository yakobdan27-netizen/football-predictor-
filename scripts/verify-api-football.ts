/**
 * Verify API-Football key + x-apisports-key header locally.
 * Run: npx tsx scripts/verify-api-football.ts
 *
 * Loads .env.local / .env if present (never commit keys).
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
  const { apiFootballGet, getApiFootballKey, getApiFootballBaseUrl } = await import(
    "../lib/football-api/client"
  );
  try {
    const keyPreview = getApiFootballKey().slice(0, 4) + "…";
    console.log("Base URL:", getApiFootballBaseUrl());
    console.log("Key present:", keyPreview);
    const status = await apiFootballGet<unknown>("/status");
    console.log("KEY WORKS. Account:", JSON.stringify(status, null, 2));
  } catch (e) {
    console.error("KEY FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}

void main();
