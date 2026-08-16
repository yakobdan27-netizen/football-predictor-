import { NextResponse } from "next/server";
import { apiFootballGet } from "@/lib/football-api/client";
import { parseApiFootballLineups } from "@/lib/football-api/parse-fixture-lineups";
import type { MatchLineups } from "@/lib/prediction-log/types";

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_FIXTURES = 50;
const CONCURRENCY = 5;

async function fetchLineupsForFixture(input: {
  fixtureId: number;
  homeTeamId?: number | null;
  awayTeamId?: number | null;
}): Promise<{ fixtureId: number; lineups: MatchLineups | null; error?: string }> {
  try {
    const rows = await apiFootballGet<unknown[]>("/fixtures/lineups", {
      fixture: input.fixtureId,
    });
    const lineups = parseApiFootballLineups(rows ?? [], {
      homeTeamId: input.homeTeamId,
      awayTeamId: input.awayTeamId,
    });
    return { fixtureId: input.fixtureId, lineups: lineups ?? null };
  } catch (e) {
    return {
      fixtureId: input.fixtureId,
      lineups: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

/** GET /api/fixtures/lineups?fixture=123&homeTeamId=&awayTeamId= */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fixtureId = Number(url.searchParams.get("fixture"));
  if (!Number.isFinite(fixtureId) || fixtureId <= 0) {
    return NextResponse.json({ error: "fixture query required" }, { status: 400 });
  }
  const homeTeamId = Number(url.searchParams.get("homeTeamId"));
  const awayTeamId = Number(url.searchParams.get("awayTeamId"));
  const result = await fetchLineupsForFixture({
    fixtureId,
    homeTeamId: Number.isFinite(homeTeamId) ? homeTeamId : null,
    awayTeamId: Number.isFinite(awayTeamId) ? awayTeamId : null,
  });
  return NextResponse.json({ ok: true, ...result });
}

/** POST { fixtures: [{ fixtureId, homeTeamId?, awayTeamId? }] } */
export async function POST(request: Request) {
  let body: {
    fixtures?: Array<{
      fixtureId: number;
      homeTeamId?: number | null;
      awayTeamId?: number | null;
    }>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fixtures = Array.isArray(body.fixtures) ? body.fixtures.slice(0, MAX_FIXTURES) : [];
  if (!fixtures.length) {
    return NextResponse.json({ error: "fixtures array required" }, { status: 400 });
  }

  const results = await mapPool(fixtures, CONCURRENCY, fetchLineupsForFixture);
  const byId: Record<number, MatchLineups | null> = {};
  for (const r of results) {
    byId[r.fixtureId] = r.lineups;
  }

  return NextResponse.json({
    ok: true,
    count: results.length,
    results,
    lineupsByFixtureId: byId,
  });
}
