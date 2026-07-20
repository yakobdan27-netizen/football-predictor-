import { NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Telegram webhook. Verify X-Telegram-Bot-Api-Secret-Token when TELEGRAM_WEBHOOK_SECRET is set.
 */
export async function POST(request: Request) {
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (secret) {
    const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (header !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!(process.env.TELEGRAM_BOT_TOKEN ?? "").trim()) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN is not configured" },
      { status: 503 }
    );
  }

  try {
    const update = await request.json();
    await handleTelegramUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[telegram/webhook]", e);
    // Always 200 to Telegram after parse to avoid retries storms on app bugs;
    // auth failures already returned 401 above.
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean((process.env.TELEGRAM_BOT_TOKEN ?? "").trim()),
  });
}
