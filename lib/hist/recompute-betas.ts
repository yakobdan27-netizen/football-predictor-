/**
 * Empirical per-league BETA_2H from hist_* (mean 2H / mean 1H goals).
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { histFixtures, histMeta } from "@/lib/db/schema";
import { BETA_2H } from "@/lib/prediction-log/two-h-heavy/config";
import { HIST_BIG5_LEAGUES, currentHistSeason } from "./seasons";

export type LeagueBetaRow = {
  league: string;
  leagueId: number;
  n: number;
  mean1h: number;
  mean2h: number;
  beta2h: number;
};

let cachedBetas: Record<string, number> | null = null;
let cachedAt = 0;
const CACHE_MS = 60 * 60 * 1000;

export async function recomputeLeagueBetas(): Promise<{
  ok: boolean;
  betas: LeagueBetaRow[];
  stored: Record<string, number>;
}> {
  const db = await getDb();
  const current = currentHistSeason();
  const betas: LeagueBetaRow[] = [];
  const stored: Record<string, number> = {};

  for (const league of HIST_BIG5_LEAGUES) {
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        mean1h: sql<number>`avg((${histFixtures.htHome} + ${histFixtures.htAway})::float)`,
        meanFt: sql<number>`avg((${histFixtures.ftHome} + ${histFixtures.ftAway})::float)`,
      })
      .from(histFixtures)
      .where(
        and(
          eq(histFixtures.leagueId, league.id),
          isNotNull(histFixtures.htHome),
          isNotNull(histFixtures.htAway),
          isNotNull(histFixtures.ftHome),
          isNotNull(histFixtures.ftAway),
          sql`${histFixtures.season} >= ${current - 7}`
        )
      );

    const n = Number(row?.n ?? 0);
    const mean1h = Number(row?.mean1h ?? NaN);
    const meanFt = Number(row?.meanFt ?? NaN);
    if (n < 8 || !Number.isFinite(mean1h) || mean1h <= 0 || !Number.isFinite(meanFt)) {
      betas.push({
        league: league.name,
        leagueId: league.id,
        n,
        mean1h: Number.isFinite(mean1h) ? mean1h : 0,
        mean2h: 0,
        beta2h: BETA_2H,
      });
      stored[league.name] = BETA_2H;
      continue;
    }
    const mean2h = Math.max(0, meanFt - mean1h);
    const beta2h = Math.min(1.4, Math.max(0.9, mean2h / mean1h));
    betas.push({
      league: league.name,
      leagueId: league.id,
      n,
      mean1h,
      mean2h,
      beta2h,
    });
    stored[league.name] = beta2h;
    console.info(
      `[hist] BETA_2H ${league.name}=${beta2h.toFixed(3)} (n=${n} mean1h=${mean1h.toFixed(3)} mean2h=${mean2h.toFixed(3)})`
    );
  }

  const now = new Date();
  await db
    .insert(histMeta)
    .values({
      id: 1,
      beta2hJson: JSON.stringify(stored),
      lastSummary: `betas recomputed ${now.toISOString()}`,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: histMeta.id,
      set: {
        beta2hJson: JSON.stringify(stored),
        lastSummary: `betas recomputed ${now.toISOString()}`,
        updatedAt: now,
      },
    });

  cachedBetas = stored;
  cachedAt = Date.now();
  return { ok: true, betas, stored };
}

export async function loadStoredBetas(): Promise<Record<string, number>> {
  if (cachedBetas && Date.now() - cachedAt < CACHE_MS) return cachedBetas;
  try {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(histMeta)
      .where(eq(histMeta.id, 1))
      .limit(1);
    if (row?.beta2hJson) {
      const parsed = JSON.parse(row.beta2hJson) as Record<string, number>;
      cachedBetas = parsed;
      cachedAt = Date.now();
      return parsed;
    }
  } catch {
    // fall through
  }
  return {};
}

/** Sync-friendly: uses in-memory cache when available; else default. */
export function beta2hFor(league: string): number {
  const v = cachedBetas?.[league];
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return BETA_2H;
}

/** Prefetch stored betas into memory (call from routes / cold start). */
export async function warmBetaCache(): Promise<Record<string, number>> {
  return loadStoredBetas();
}
