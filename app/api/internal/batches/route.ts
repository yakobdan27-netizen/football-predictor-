import { NextResponse } from "next/server";
import { saveBatch } from "@/lib/prediction-log/club-store";
import { requireInternalApiKey } from "@/lib/telegram/internal-auth";
import { listBatchesForUser } from "@/lib/telegram/ownership";
import { buildTelegramBatch } from "@/lib/telegram/decision-service";
import { addUserBatchId } from "@/lib/telegram/user-store";
import { deriveBatchLeague } from "@/lib/prediction-log/match-league";

export async function GET(request: Request) {
  const denied = requireInternalApiKey(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const ownerUserId = url.searchParams.get("ownerUserId")?.trim();
    if (!ownerUserId) {
      return NextResponse.json({ error: "ownerUserId required" }, { status: 400 });
    }
    const batches = await listBatchesForUser(ownerUserId);
    return NextResponse.json({
      ok: true,
      batches: batches.map((b) => ({
        id: b.id,
        batchName: b.batchName,
        date: b.date,
        league: b.league,
        matchCount: b.matches.length,
        createdAt: b.createdAt,
        source: b.source ?? "telegram",
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "List failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const denied = requireInternalApiKey(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as {
      ownerUserId?: string;
      batchName?: string;
      date?: string;
      league?: string;
      matches?: {
        homeTeam: string;
        awayTeam: string;
        league?: string;
        date?: string;
      }[];
    };

    if (!body.ownerUserId || !body.batchName?.trim()) {
      return NextResponse.json(
        { error: "ownerUserId and batchName required" },
        { status: 400 }
      );
    }
    if (!body.matches?.length) {
      return NextResponse.json({ error: "At least one match required" }, { status: 400 });
    }

    const date =
      body.date?.trim() ||
      body.matches[0]?.date ||
      new Date().toISOString().slice(0, 10);

    const normalizedMatches = body.matches.map((m) => ({
      homeTeam: m.homeTeam.trim(),
      awayTeam: m.awayTeam.trim(),
      league: (m.league || body.league || "Premier League").trim(),
      date: (m.date || date).trim(),
    }));

    const league =
      body.league?.trim() ||
      deriveBatchLeague(
        normalizedMatches.map((m, i) => ({
          id: `tmp-${i}`,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          league: m.league,
          predictions: {},
          actualResults: {},
          scored: {},
        }))
      );

    const batch = buildTelegramBatch({
      ownerUserId: body.ownerUserId,
      batchName: body.batchName,
      date,
      league,
      matches: normalizedMatches,
    });

    await saveBatch(batch);
    await addUserBatchId(body.ownerUserId, batch.id);

    return NextResponse.json({ ok: true, batch });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Create failed" },
      { status: 500 }
    );
  }
}
