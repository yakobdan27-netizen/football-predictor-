/**
 * Load/save competition half-share + DIEH κ params (server / Node only).
 */
import { getDb } from "@/lib/db";
import { histLeagueHalfParams } from "@/lib/db/schema";
import {
  emptyHalfParamsStore,
  setCachedHalfParams,
  type HalfParamsStore,
  type LeagueHalfParams,
} from "./half-params-types";

export * from "./half-params-types";

function rowToParams(row: typeof histLeagueHalfParams.$inferSelect): LeagueHalfParams {
  return {
    leagueId: row.leagueId,
    compType: row.compType === "cup" ? "cup" : "league",
    leagueName: row.leagueName,
    s1: row.s1,
    s1Home: row.s1Home,
    s1Away: row.s1Away,
    usedCombinedShareHome: row.usedCombinedShareHome === 1,
    usedCombinedShareAway: row.usedCombinedShareAway === 1,
    nValid: row.nValid,
    nHomeGoalsSample: row.nHomeGoalsSample,
    nAwayGoalsSample: row.nAwayGoalsSample,
    kappaRaw: row.kappaRaw,
    kappaAdj: row.kappaAdj,
    pD1Obs: row.pD1Obs,
    pD2Obs: row.pD2Obs,
    pD1d2Obs: row.pD1d2Obs,
    goalsMean: row.goalsMean,
    goalsVariance: row.goalsVariance,
    goalsDispersion: row.goalsDispersion,
    goalsDistribution:
      row.goalsDistribution === "negbin" ? "negbin" : "poisson",
    computedAt: row.computedAt.toISOString(),
  };
}

export async function loadHalfParamsStore(): Promise<HalfParamsStore> {
  const { getCachedHalfParams } = await import("./half-params-types");
  const cached = getCachedHalfParams();
  if (cached && cached.leagues.length > 0) return cached;
  const db = await getDb();
  const rows = await db.select().from(histLeagueHalfParams);
  const store: HalfParamsStore =
    rows.length === 0
      ? emptyHalfParamsStore()
      : {
          fittedAt: new Date(
            Math.max(...rows.map((r) => r.computedAt.getTime()))
          ).toISOString(),
          leagues: rows.map(rowToParams),
        };
  setCachedHalfParams(store);
  return store;
}

export async function saveHalfParamsRows(
  rows: LeagueHalfParams[]
): Promise<HalfParamsStore> {
  const db = await getDb();
  const now = new Date();
  for (const r of rows) {
    await db
      .insert(histLeagueHalfParams)
      .values({
        leagueId: r.leagueId,
        compType: r.compType,
        leagueName: r.leagueName,
        s1: r.s1,
        s1Home: r.s1Home,
        s1Away: r.s1Away,
        usedCombinedShareHome: r.usedCombinedShareHome ? 1 : 0,
        usedCombinedShareAway: r.usedCombinedShareAway ? 1 : 0,
        nValid: r.nValid,
        nHomeGoalsSample: r.nHomeGoalsSample,
        nAwayGoalsSample: r.nAwayGoalsSample,
        kappaRaw: r.kappaRaw,
        kappaAdj: r.kappaAdj,
        pD1Obs: r.pD1Obs,
        pD2Obs: r.pD2Obs,
        pD1d2Obs: r.pD1d2Obs,
        goalsMean: r.goalsMean,
        goalsVariance: r.goalsVariance,
        goalsDispersion: r.goalsDispersion,
        goalsDistribution: r.goalsDistribution,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: [histLeagueHalfParams.leagueId, histLeagueHalfParams.compType],
        set: {
          leagueName: r.leagueName,
          s1: r.s1,
          s1Home: r.s1Home,
          s1Away: r.s1Away,
          usedCombinedShareHome: r.usedCombinedShareHome ? 1 : 0,
          usedCombinedShareAway: r.usedCombinedShareAway ? 1 : 0,
          nValid: r.nValid,
          nHomeGoalsSample: r.nHomeGoalsSample,
          nAwayGoalsSample: r.nAwayGoalsSample,
          kappaRaw: r.kappaRaw,
          kappaAdj: r.kappaAdj,
          pD1Obs: r.pD1Obs,
          pD2Obs: r.pD2Obs,
          pD1d2Obs: r.pD1d2Obs,
          goalsMean: r.goalsMean,
          goalsVariance: r.goalsVariance,
          goalsDispersion: r.goalsDispersion,
          goalsDistribution: r.goalsDistribution,
          computedAt: now,
        },
      });
  }
  const store: HalfParamsStore = {
    fittedAt: now.toISOString(),
    leagues: rows.map((r) => ({ ...r, computedAt: now.toISOString() })),
  };
  setCachedHalfParams(store);
  return store;
}
