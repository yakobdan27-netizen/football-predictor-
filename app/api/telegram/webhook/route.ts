import { after, NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/telegram/bot";
import { claimTelegramUpdate } from "@/lib/telegram/user-store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Telegram webhook. Verify X-Telegram-Bot-Api-Secret-Token when TELEGRAM_WEBHOOK_SECRET is set.
 * Respond 200 immediately (via after) so Telegram does not retry and wipe mid-flow sessions.
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

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateId =
    update &&
    typeof update === "object" &&
    "update_id" in update &&
    typeof (update as { update_id: unknown }).update_id === "number"
      ? (update as { update_id: number }).update_id
      : null;

  after(async () => {
    try {
      if (updateId != null) {
        const claim = await claimTelegramUpdate(updateId);
        if (!claim) return;
      }
      await handleTelegramUpdate(update);
    } catch (e) {
      console.error("[telegram/webhook]", e);
    }
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: Boolean((process.env.TELEGRAM_BOT_TOKEN ?? "").trim()),
  });
}
