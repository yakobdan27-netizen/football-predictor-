/**
 * Register Telegram webhook for production.
 * Run: npx tsx scripts/set-telegram-webhook.ts
 *
 * Requires TELEGRAM_BOT_TOKEN and optionally TELEGRAM_WEBHOOK_SECRET in .env.local
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
  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  const base =
    (process.env.TELEGRAM_WEBHOOK_URL ?? "").trim() ||
    "https://football-predictor-app-two.vercel.app/api/telegram/webhook";

  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN missing");
    process.exitCode = 1;
    return;
  }

  const url = new URL(`https://api.telegram.org/bot${token}/setWebhook`);
  url.searchParams.set("url", base);
  if (secret) url.searchParams.set("secret_token", secret);
  url.searchParams.set("drop_pending_updates", "true");

  const res = await fetch(url.toString());
  const data = (await res.json()) as { ok?: boolean; description?: string };
  console.log(JSON.stringify(data, null, 2));
  if (!data.ok) process.exitCode = 1;
}

void main();
