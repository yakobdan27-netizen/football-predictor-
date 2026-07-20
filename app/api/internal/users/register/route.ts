import { NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/telegram/internal-auth";
import { registerTelegramUser } from "@/lib/telegram/user-store";

export async function POST(request: Request) {
  const denied = requireInternalApiKey(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as {
      telegram_id?: string | number;
      telegramId?: string | number;
      display_name?: string;
      displayName?: string;
      username?: string | null;
    };
    const telegramId = String(body.telegram_id ?? body.telegramId ?? "").trim();
    if (!telegramId) {
      return NextResponse.json({ error: "telegram_id required" }, { status: 400 });
    }
    const result = await registerTelegramUser({
      telegramId,
      username: body.username ?? null,
      displayName: body.display_name ?? body.displayName ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Register failed" },
      { status: 500 }
    );
  }
}
