/**
 * Hist-derived league scoring priors (goals/game, O/U 2.5, BTTS)
 * with 11-season recency weighting. Stored on hist_meta.league_priors_json.
 */
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { histFixtures, histMeta } from "@/lib/db/schema";
import {
  DEFAULT_LEAGUE_TOTAL,
  LEAGUE_TOTAL,
} from "@/lib/prediction-log/two-h-heavy/static-league-totals";
import { setLeagueTotalCache } from "./league-total-cache";
import {
  HIST_DOMESTIC_LEAGUES,
  HIST_COMPLETED_SEASON_COUNT,
  currentHistSeason,
  histSeasonWeight,
  histWindowMinSeason,
} from "./seasons";

/** Local fallbacks — avoid circular import with two-h-heavy/config. */
const MIN_MATCHES = 8;

export type LeaguePriorRow = {
  league: string;
  leagueId: number;
  n: number;
  weightedN: number;
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
  const minSeason = histWindowMinSeason();
  const priors: LeaguePriorRow[] = [];
  const stored: Record<string, LeaguePriorRow> = {};

  for (const league of HIST_DOMESTIC_LEAGUES) {
    const rows = await db
      .select({
        season: histFixtures.season,
        ftHome: histFixtures.ftHome,
        ftAway: histFixtures.ftAway,
      })
      .from(histFixtures)
      .where(
        and(
          eq(histFixtures.leagueId, league.id),
          eq(histFixtures.compType, "league"),
          isNotNull(histFixtures.ftHome),
          isNotNull(histFixtures.ftAway),
          gte(histFixtures.season, minSeason)
        )
      );

    let wSum = 0;
    let gSum = 0;
    let overSum = 0;
    let bttsSum = 0;
    for (const r of rows) {
      const w = histSeasonWeight(r.season, current);
      const total = r.ftHome! + r.ftAway!;
      wSum += w;
      gSum += total * w;
      if (total > 2.5) overSum += w;
      if (r.ftHome! > 0 && r.ftAway! > 0) bttsSum += w;
    }

    const n = rows.length;
    const fallback = LEAGUE_TOTAL[league.name] ?? DEFAULT_LEAGUE_TOTAL;
    const prior: LeaguePriorRow = {
      league: league.name,
      leagueId: league.id,
      n,
      weightedN: wSum,
      goalsPerGame:
        n >= MIN_MATCHES && wSum > 0 ? gSum / wSum : fallback,
      over25Rate: n >= MIN_MATCHES && wSum > 0 ? overSum / wSum : null,
      bttsRate: n >= MIN_MATCHES && wSum > 0 ? bttsSum / wSum : null,
    };
    priors.push(prior);
    stored[league.name] = prior;
    console.info(
      `[hist] league prior ${league.name}: gpg=${prior.goalsPerGame.toFixed(3)} n=${n} wN=${wSum.toFixed(1)} (window=${HIST_COMPLETED_SEASON_COUNT})`
    );
  }

  const now = new Date();
  await db
    .insert(histMeta)
    .values({
      id: 1,
      leaguePriorsJson: JSON.stringify(stored),
      lastSummary: `league priors recomputed ${now.toISOString()} (${HIST_COMPLETED_SEASON_COUNT} seasons weighted)`,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: histMeta.id,
      set: {
        leaguePriorsJson: JSON.stringify(stored),
        lastSummary: `league priors recomputed ${now.toISOString()} (${HIST_COMPLETED_SEASON_COUNT} seasons weighted)`,
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
