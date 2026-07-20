import { NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/telegram/internal-auth";
import { getTelegramUserByTelegramId } from "@/lib/telegram/user-store";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ telegramId: string }> }
) {
  const denied = requireInternalApiKey(request);
  if (denied) return denied;

  try {
    const { telegramId } = await ctx.params;
    const user = await getTelegramUserByTelegramId(telegramId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, user });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Lookup failed" },
      { status: 500 }
    );
  }
}
