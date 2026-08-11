import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureSchema } from "@/lib/db/init";
import { sqlCount } from "@/lib/core/sql-count";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Nightly integrity summary for core_* (disabled in vercel.json until validated).
 * Writes a short summary into logs; does not mutate legacy tables.
 */
function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

async function run(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await ensureSchema();
    const db = await getDb();
    const summary = {
      hist_fixtures: await sqlCount(db, "SELECT count(*)::int AS c FROM hist_fixtures"),
      core_fixture: await sqlCount(db, "SELECT count(*)::int AS c FROM core_fixture"),
      mapped_verified: await sqlCount(
        db,
        `SELECT count(*)::int AS c FROM core_legacy_record_map
         WHERE legacy_source_table = 'hist_fixtures' AND verified = 1`
      ),
      finished_without_scores: await sqlCount(
        db,
        `SELECT count(*)::int AS c FROM core_fixture
         WHERE upper(status) IN ('FT','AET','PEN')
           AND (ft_home IS NULL OR ft_away IS NULL)`
      ),
      duplicate_provider_ids: await sqlCount(
        db,
        `SELECT count(*)::int AS c FROM (
           SELECT provider_name, provider_fixture_id FROM core_fixture
           GROUP BY 1, 2 HAVING count(*) > 1
         ) d`
      ),
      orphan_stats: await sqlCount(
        db,
        `SELECT count(*)::int AS c FROM core_fixture_statistic s
         LEFT JOIN core_fixture f ON f.id = s.fixture_id WHERE f.id IS NULL`
      ),
      result_trace_pending: await sqlCount(
        db,
        `SELECT count(*)::int AS c FROM core_result_trace
         WHERE status IN ('pending','unresolved','not_final')`
      ),
      at: new Date().toISOString(),
    };

    console.log("[core-integrity]", JSON.stringify(summary));
    const ok =
      summary.duplicate_provider_ids === 0 && summary.orphan_stats === 0;

    return NextResponse.json({ ok, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "core integrity failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
