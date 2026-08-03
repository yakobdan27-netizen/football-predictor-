/**
 * Empirical per-league BETA_2H from hist_* (mean 2H / mean 1H goals).
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { histFixtures, histMeta } from "@/lib/db/schema";
import { BETA_2H } from "@/lib/prediction-log/two-h-heavy/config";
import { setBeta2hCache, beta2hFor as beta2hFromCache } from "./beta-cache";
import { HIST_BIG5_LEAGUES, currentHistSeason } from "./seasons";

export type LeagueBetaRow = {
  league: string;
  leagueId: number;
  n: number;
  mean1h: number;
  mean2h: number;
  beta2h: number;
  previousBeta2h: number;
};

export async function recomputeLeagueBetas(): Promise<{
  ok: boolean;
  betas: LeagueBetaRow[];
  stored: Record<string, number>;
  changes: Array<{ league: string; old: number; new: number }>;
}> {
  const db = await getDb();
  const current = currentHistSeason();
  const previous = await loadStoredBetas();
  const betas: LeagueBetaRow[] = [];
  const stored: Record<string, number> = {};
  const changes: Array<{ league: string; old: number; new: number }> = [];

  for (const league of HIST_BIG5_LEAGUES) {
    const oldBeta = previous[league.name] ?? BETA_2H;
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
    if (
      n < 8 ||
      !Number.isFinite(mean1h) ||
      mean1h <= 0 ||
      !Number.isFinite(meanFt)
    ) {
      betas.push({
        league: league.name,
        leagueId: league.id,
        n,
        mean1h: Number.isFinite(mean1h) ? mean1h : 0,
        mean2h: 0,
        beta2h: BETA_2H,
        previousBeta2h: oldBeta,
      });
      stored[league.name] = BETA_2H;
      changes.push({ league: league.name, old: oldBeta, new: BETA_2H });
      console.info(
        `[hist] BETA_2H ${league.name}: ${oldBeta.toFixed(3)} → ${BETA_2H.toFixed(3)} (fallback, n=${n})`
      );
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
      previousBeta2h: oldBeta,
    });
    stored[league.name] = beta2h;
    changes.push({ league: league.name, old: oldBeta, new: beta2h });
    console.info(
      `[hist] BETA_2H ${league.name}: ${oldBeta.toFixed(3)} → ${beta2h.toFixed(3)} (n=${n} mean1h=${mean1h.toFixed(3)} mean2h=${mean2h.toFixed(3)})`
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

  setBeta2hCache(stored);
  return { ok: true, betas, stored, changes };
}

export async function loadStoredBetas(): Promise<Record<string, number>> {
  try {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(histMeta)
      .where(eq(histMeta.id, 1))
      .limit(1);
    if (row?.beta2hJson) {
      const parsed = JSON.parse(row.beta2hJson) as Record<string, number>;
      setBeta2hCache(parsed);
      return parsed;
    }
  } catch {
    // fall through
  }
  return {};
}

/** Sync-friendly: uses in-memory cache when available; else default. */
export function beta2hFor(league: string): number {
  return beta2hFromCache(league);
}

/** Prefetch stored betas into memory (call from routes / cold start). */
export async function warmBetaCache(): Promise<Record<string, number>> {
  return loadStoredBetas();
}
