/**
 * Quota-aware preflight for hist backfill chunks.
 */
import { logApiFootballHealth } from "@/lib/apiClient";
import { getLastQuotaRemaining } from "@/lib/live/rate-limit";
import { getDb } from "@/lib/db";
import { histMeta } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Abort chunk when remaining requests fall below this. */
export const HIST_QUOTA_SAFETY_MARGIN = 50;

/** Enrich calls per finished fixture (events + stats + lineups). */
export const HIST_ENRICH_CALLS_PER_FIXTURE = 3;

export type HistPreflight = {
  ok: boolean;
  plan: string | null;
  limitDay: number | null;
  current: number | null;
  remaining: number | null;
  active: boolean | null;
  /** How many fixture enrichments fit today after safety margin. */
  maxEnrichToday: number;
  abort: boolean;
  reason?: string;
};

export async function runHistPreflight(): Promise<HistPreflight> {
  const health = await logApiFootballHealth();
  const remainingHeader = getLastQuotaRemaining();
  const remaining =
    remainingHeader ??
    (health.limitDay != null && health.current != null
      ? Math.max(0, health.limitDay - health.current)
      : null);

  const usable =
    remaining == null
      ? 0
      : Math.max(0, remaining - HIST_QUOTA_SAFETY_MARGIN);
  const maxEnrichToday = Math.floor(usable / HIST_ENRICH_CALLS_PER_FIXTURE);

  let abort = false;
  let reason: string | undefined;
  if (!health.ok) {
    abort = true;
    reason = health.error ?? "status failed";
  } else if (remaining != null && remaining < HIST_QUOTA_SAFETY_MARGIN) {
    abort = true;
    reason = `quota remaining ${remaining} < safety margin ${HIST_QUOTA_SAFETY_MARGIN}`;
  }

  try {
    const db = await getDb();
    const now = new Date();
    await db
      .insert(histMeta)
      .values({
        id: 1,
        plan: health.plan,
        limitDay: health.limitDay,
        remaining,
        lastRunAt: now,
        lastSummary: abort
          ? `preflight abort: ${reason}`
          : `preflight ok maxEnrich=${maxEnrichToday}`,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: histMeta.id,
        set: {
          plan: health.plan,
          limitDay: health.limitDay,
          remaining,
          lastRunAt: now,
          lastSummary: abort
            ? `preflight abort: ${reason}`
            : `preflight ok maxEnrich=${maxEnrichToday}`,
          updatedAt: now,
        },
      });
  } catch {
    // Meta write is best-effort
  }

  return {
    ok: health.ok && !abort,
    plan: health.plan,
    limitDay: health.limitDay,
    current: health.current,
    remaining,
    active: health.active,
    maxEnrichToday,
    abort,
    reason,
  };
}

export async function updateHistMetaSummary(summary: string): Promise<void> {
  try {
    const db = await getDb();
    const now = new Date();
    await db
      .insert(histMeta)
      .values({
        id: 1,
        lastRunAt: now,
        lastSummary: summary,
        remaining: getLastQuotaRemaining(),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: histMeta.id,
        set: {
          lastRunAt: now,
          lastSummary: summary,
          remaining: getLastQuotaRemaining(),
          updatedAt: now,
        },
      });
  } catch {
    // ignore
  }
}

export async function readHistMeta() {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(histMeta)
    .where(eq(histMeta.id, 1))
    .limit(1);
  return row ?? null;
}
