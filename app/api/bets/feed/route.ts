import { NextResponse } from "next/server";
import { buildBetFeed } from "@/lib/bets/feed";
import { ensureBetSettlementRegistered } from "@/lib/bets/register-settlement";
import { TRACKING_BANNER } from "@/lib/bets/constants";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  ensureBetSettlementRegistered();
  try {
    const url = new URL(request.url);
    const tab = (url.searchParams.get("tab") ?? "pre").toLowerCase();
    if (tab !== "pre" && tab !== "live") {
      return NextResponse.json(
        { ok: false, error: "tab must be pre or live" },
        { status: 400 }
      );
    }
    const feed = await buildBetFeed(tab);
    return NextResponse.json({
      ok: true,
      tab,
      banner: TRACKING_BANNER,
      ...feed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Feed failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
