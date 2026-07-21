import { NextResponse } from "next/server";
import {
  loadLeaguePriorsStore,
  recomputeAndPersistLeaguePriors,
  upsertLeaguePriorRecord,
} from "@/lib/prediction-log/league-priors-store";
import type { LeaguePriorRecord } from "@/lib/prediction-log/league-priors";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const recompute = url.searchParams.get("recompute") === "1";
    const store = recompute
      ? await recomputeAndPersistLeaguePriors()
      : await loadLeaguePriorsStore();
    return NextResponse.json({ store });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load league priors";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      prior?: LeaguePriorRecord;
      recompute?: boolean;
    };
    if (body.recompute) {
      const store = await recomputeAndPersistLeaguePriors();
      return NextResponse.json({ ok: true, store });
    }
    if (!body.prior?.leagueId) {
      return NextResponse.json({ error: "prior.leagueId required" }, { status: 400 });
    }
    const store = await upsertLeaguePriorRecord(body.prior);
    return NextResponse.json({ ok: true, store });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save league priors";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { recompute?: boolean };
    if (body.recompute === false) {
      const store = await loadLeaguePriorsStore();
      return NextResponse.json({ ok: true, store });
    }
    const store = await recomputeAndPersistLeaguePriors();
    return NextResponse.json({ ok: true, store });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to recompute league priors";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
