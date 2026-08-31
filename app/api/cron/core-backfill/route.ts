import { NextResponse } from "next/server";
import {
  backfillFromHist,
  countCoreTables,
} from "@/lib/core/backfill-from-hist";
import { ensureSchema } from "@/lib/db/init";
import { authorizeCron } from "@/lib/live/cron-auth";
import { sqlCount } from "@/lib/core/sql-count";
import { getDb } from "@/lib/db";

export const maxDuration = 60;
export const runtime = "nodejs";

const CORE_BACKFILL_LIMIT = 400;

async function run(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureSchema();
    const report = await backfillFromHist({
      limit: CORE_BACKFILL_LIMIT,
      skipKvTraces: true,
    });
    const counts = await countCoreTables();
    const db = await getDb();
    const histTotal = await sqlCount(
      db,
      "SELECT count(*)::int AS c FROM hist_fixtures"
    );

    return NextResponse.json({
      ok: true,
      limit: CORE_BACKFILL_LIMIT,
      report,
      counts,
      histFixturesTotal: histTotal,
      coreFixturesTotal: counts.core_fixture ?? 0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
