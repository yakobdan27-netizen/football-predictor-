import { NextResponse } from "next/server";
import { findOrCreateBatchForFixture } from "@/lib/football-api/open-in-dm";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      apiFixtureId?: number;
      matchDate?: string;
      kickoffIso?: string;
      home?: { id?: number | null; name?: string };
      away?: { id?: number | null; name?: string };
      league?: string;
      status?: string;
    };

    const homeName = body.home?.name?.trim() ?? "";
    const awayName = body.away?.name?.trim() ?? "";
    if (
      body.apiFixtureId == null ||
      !Number.isFinite(body.apiFixtureId) ||
      !homeName ||
      !awayName ||
      !body.matchDate ||
      !body.league?.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "apiFixtureId, matchDate, league, home.name, and away.name are required",
        },
        { status: 400 }
      );
    }

    const result = await findOrCreateBatchForFixture({
      apiFixtureId: Number(body.apiFixtureId),
      matchDate: body.matchDate,
      kickoffIso: body.kickoffIso,
      home: { id: body.home?.id, name: homeName },
      away: { id: body.away?.id, name: awayName },
      league: body.league.trim(),
      status: body.status,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to open in Decision Maker";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
