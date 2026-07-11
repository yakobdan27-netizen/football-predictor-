import { NextResponse } from "next/server";
import { listLivescoreFixtures } from "@/lib/livescore/list-fixtures";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let body: {
      date?: string;
      competition?: string;
      league?: string;
      includeLineups?: boolean;
    } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }

    if (!body.date?.trim()) {
      return NextResponse.json({ error: "date is required" }, { status: 400 });
    }

    const fixtures = await listLivescoreFixtures({
      date: body.date.trim(),
      competition: body.competition,
      league: body.league,
      includeLineups: body.includeLineups !== false,
    });

    return NextResponse.json({ ok: true, fixtures });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load Livescore fixtures";
    console.error("[livescore-fixtures]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
