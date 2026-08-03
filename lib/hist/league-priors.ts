/**
 * Hist-derived league scoring priors (goals/game, O/U 2.5, BTTS).
 * Stored on hist_meta.league_priors_json; sync readers use in-memory cache.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { histFixtures, histMeta } from "@/lib/db/schema";
import {
  DEFAULT_LEAGUE_TOTAL,
  LEAGUE_TOTAL,
} from "@/lib/prediction-log/two-h-heavy/static-league-totals";
import { setLeagueTotalCache } from "./league-total-cache";
import { HIST_BIG5_LEAGUES, currentHistSeason } from "./seasons";

/** Local fallbacks — avoid circular import with two-h-heavy/config. */
const MIN_MATCHES = 8;

export type LeaguePriorRow = {
  league: string;
  leagueId: number;
  n: number;
  goalsPerGame: number;
  over25Rate: number | null;
  bttsRate: number | null;
};

let cachedPriors: Record<string, LeaguePriorRow> | null = null;
let cachedAt = 0;
const CACHE_MS = 60 * 60 * 1000;

export async function recomputeLeaguePriors(): Promise<{
  ok: boolean;
  priors: LeaguePriorRow[];
  stored: Record<string, LeaguePriorRow>;
}> {
  const db = await getDb();
  const current = currentHistSeason();
  const priors: LeaguePriorRow[] = [];
  const stored: Record<string, LeaguePriorRow> = {};

  for (const league of HIST_BIG5_LEAGUES) {
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        avg: sql<number>`avg((${histFixtures.ftHome} + ${histFixtures.ftAway})::float)`,
        over25: sql<number>`avg(case when (${histFixtures.ftHome} + ${histFixtures.ftAway}) > 2.5 then 1.0 else 0.0 end)`,
        btts: sql<number>`avg(case when ${histFixtures.ftHome} > 0 and ${histFixtures.ftAway} > 0 then 1.0 else 0.0 end)`,
      })
      .from(histFixtures)
      .where(
        and(
          eq(histFixtures.leagueId, league.id),
          isNotNull(histFixtures.ftHome),
          isNotNull(histFixtures.ftAway),
          sql`${histFixtures.season} >= ${current - 7}`
        )
      );

    const n = Number(row?.n ?? 0);
    const avg = Number(row?.avg ?? NaN);
    const fallback = LEAGUE_TOTAL[league.name] ?? DEFAULT_LEAGUE_TOTAL;
    const prior: LeaguePriorRow = {
      league: league.name,
      leagueId: league.id,
      n,
      goalsPerGame:
        n >= MIN_MATCHES && Number.isFinite(avg) ? avg : fallback,
      over25Rate:
        n >= MIN_MATCHES && Number.isFinite(Number(row?.over25))
          ? Number(row!.over25)
          : null,
      bttsRate:
        n >= MIN_MATCHES && Number.isFinite(Number(row?.btts))
          ? Number(row!.btts)
          : null,
    };
    priors.push(prior);
    stored[league.name] = prior;
    console.info(
      `[hist] league prior ${league.name}: gpg=${prior.goalsPerGame.toFixed(3)} n=${n} (fallback_const=${fallback})`
    );
  }

  const now = new Date();
  await db
    .insert(histMeta)
    .values({
      id: 1,
      leaguePriorsJson: JSON.stringify(stored),
      lastSummary: `league priors recomputed ${now.toISOString()}`,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: histMeta.id,
      set: {
        leaguePriorsJson: JSON.stringify(stored),
        lastSummary: `league priors recomputed ${now.toISOString()}`,
        updatedAt: now,
      },
    });

  cachedPriors = stored;
  cachedAt = Date.now();
  setLeagueTotalCache(
    Object.fromEntries(
      Object.entries(stored).map(([k, v]) => [k, v.goalsPerGame])
    )
  );
  return { ok: true, priors, stored };
}

export async function loadStoredLeaguePriors(): Promise<
  Record<string, LeaguePriorRow>
> {
  if (cachedPriors && Date.now() - cachedAt < CACHE_MS) return cachedPriors;
  try {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(histMeta)
      .where(eq(histMeta.id, 1))
      .limit(1);
    if (row?.leaguePriorsJson) {
      const parsed = JSON.parse(row.leaguePriorsJson) as Record<
        string,
        LeaguePriorRow
      >;
      cachedPriors = parsed;
      cachedAt = Date.now();
      setLeagueTotalCache(
        Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [k, v.goalsPerGame])
        )
      );
      return parsed;
    }
  } catch {
    // fall through
  }
  return {};
}

export async function warmLeaguePriorsCache(): Promise<
  Record<string, LeaguePriorRow>
> {
  return loadStoredLeaguePriors();
}

/** Re-export thin cache helper for server callers. */
export { leagueTotalFromCache } from "./league-total-cache";
