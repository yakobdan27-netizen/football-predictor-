/**
 * Quota-aware preflight for hist backfill chunks.
 */
import { logApiFootballHealth } from "@/lib/apiClient";
import { getLastQuotaRemaining } from "@/lib/live/rate-limit";
import { getDb } from "@/lib/db";
import { histMeta } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/** Default cron chunk ceiling — keep in sync with daily-drain. */
const HIST_CRON_MAX_CHUNKS_DEFAULT = 3;

/** Abort chunk when remaining requests fall below this (normal mode). */
export const HIST_QUOTA_SAFETY_MARGIN = 50;

/** Hard floor — below this, no API calls. */
export const HIST_QUOTA_ABORT_FLOOR = 5;

function cronMaxChunksFromEnvLocal(): number {
  const n = Number(process.env.HIST_CRON_MAX_CHUNKS);
  if (!Number.isFinite(n) || n <= 0) return HIST_CRON_MAX_CHUNKS_DEFAULT;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

/** Enrich calls per finished fixture (events + stats + lineups). */
export const HIST_ENRICH_CALLS_PER_FIXTURE = 3;

export type HistSyncMode = "normal" | "conservative" | "minimal" | "abort";

export type HistSyncTier = {
  syncMode: HistSyncMode;
  safetyMargin: number;
  recommendedMaxChunks: number;
  maxEnrichToday: number;
  abort: boolean;
  reason?: string;
};

export type HistPreflight = HistSyncTier & {
  ok: boolean;
  plan: string | null;
  limitDay: number | null;
  current: number | null;
  remaining: number | null;
  active: boolean | null;
};

/** Pure tier resolver — testable without API calls. */
export function resolveHistSyncTier(
  remaining: number | null,
  healthOk: boolean
): HistSyncTier {
  if (!healthOk) {
    return {
      syncMode: "abort",
      safetyMargin: 0,
      recommendedMaxChunks: 0,
      maxEnrichToday: 0,
      abort: true,
      reason: "API health check failed",
    };
  }
  if (remaining == null) {
    return {
      syncMode: "abort",
      safetyMargin: 0,
      recommendedMaxChunks: 0,
      maxEnrichToday: 0,
      abort: true,
      reason: "quota remaining unknown",
    };
  }
  if (remaining < HIST_QUOTA_ABORT_FLOOR) {
    return {
      syncMode: "abort",
      safetyMargin: 0,
      recommendedMaxChunks: 0,
      maxEnrichToday: 0,
      abort: true,
      reason: `quota remaining ${remaining} < abort floor ${HIST_QUOTA_ABORT_FLOOR}`,
    };
  }
  if (remaining >= HIST_QUOTA_SAFETY_MARGIN) {
    const usable = Math.max(0, remaining - HIST_QUOTA_SAFETY_MARGIN);
    return {
      syncMode: "normal",
      safetyMargin: HIST_QUOTA_SAFETY_MARGIN,
      recommendedMaxChunks: cronMaxChunksFromEnvLocal(),
      maxEnrichToday: Math.floor(usable / HIST_ENRICH_CALLS_PER_FIXTURE),
      abort: false,
    };
  }
  if (remaining >= 15) {
    const usable = Math.max(0, remaining - 10);
    const maxEnrich = Math.min(
      5,
      Math.floor(usable / HIST_ENRICH_CALLS_PER_FIXTURE)
    );
    return {
      syncMode: "conservative",
      safetyMargin: 10,
      recommendedMaxChunks: 1,
      maxEnrichToday: Math.max(1, maxEnrich),
      abort: false,
      reason: `conservative sync: remaining=${remaining}`,
    };
  }
  return {
    syncMode: "minimal",
    safetyMargin: 3,
    recommendedMaxChunks: 1,
    maxEnrichToday: 1,
    abort: false,
    reason: `minimal sync: remaining=${remaining}`,
  };
}

export async function runHistPreflight(): Promise<HistPreflight> {
  const health = await logApiFootballHealth();
  const remainingHeader = getLastQuotaRemaining();
  const remaining =
    remainingHeader ??
    (health.limitDay != null && health.current != null
      ? Math.max(0, health.limitDay - health.current)
      : null);

  const tier = resolveHistSyncTier(remaining, health.ok);
  const summary = tier.abort
    ? `preflight abort: ${tier.reason ?? "quota"}`
    : `${tier.syncMode} sync: maxEnrich=${tier.maxEnrichToday} chunks=${tier.recommendedMaxChunks}`;

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
        lastSummary: summary,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: histMeta.id,
        set: {
          plan: health.plan,
          limitDay: health.limitDay,
          remaining,
          lastRunAt: now,
          lastSummary: summary,
          updatedAt: now,
        },
      });
  } catch {
    // Meta write is best-effort
  }

  return {
    ok: health.ok && !tier.abort,
    plan: health.plan,
    limitDay: health.limitDay,
    current: health.current,
    remaining,
    active: health.active,
    ...tier,
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
