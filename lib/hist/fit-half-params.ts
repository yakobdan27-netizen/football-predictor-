/**
 * Fit per-competition half shares and DIEH dependence κ from hist_fixtures.
 * RULE 0.1 — never derive half rates by halving full-match λ.
 */
import { and, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { histFixtures } from "@/lib/db/schema";
import { histSeasonWeight, histWindowMinSeason, HIST_LEAGUES } from "./seasons";
import {
  chooseGoalsDistribution,
  DIEH_MIN_VALID_FIXTURES,
  HALF_SHARE_SIDE_MIN_SAMPLE,
  KAPPA_SHRINKAGE_M,
  type LeagueHalfParams,
} from "./half-params-types";
import { saveHalfParamsRows } from "./half-params";

export type HalfFixtureRow = {
  fixtureId: number;
  season: number;
  htHome: number;
  htAway: number;
  ftHome: number;
  ftAway: number;
};

export type DerivedHalfGoals = {
  fixtureId: number;
  season: number;
  h1Home: number;
  h1Away: number;
  h2Home: number;
  h2Away: number;
  totalGoals: number;
  d1: boolean;
  d2: boolean;
  weight: number;
};

/** Derive per-half goals; exclude corrupt HT (negative 2H) with logging. */
export function deriveHalfGoals(
  rows: HalfFixtureRow[],
  currentSeason: number,
  logCorrupt?: (fixtureId: number) => void
): DerivedHalfGoals[] {
  const out: DerivedHalfGoals[] = [];
  for (const r of rows) {
    const h1Home = r.htHome;
    const h1Away = r.htAway;
    const h2Home = r.ftHome - r.htHome;
    const h2Away = r.ftAway - r.htAway;
    if (h2Home < 0 || h2Away < 0) {
      logCorrupt?.(r.fixtureId);
      console.warn(
        `[fit-half-params] corrupt HT data fixture=${r.fixtureId} HT=${r.htHome}-${r.htAway} FT=${r.ftHome}-${r.ftAway}`
      );
      continue;
    }
    const totalGoals = r.ftHome + r.ftAway;
    out.push({
      fixtureId: r.fixtureId,
      season: r.season,
      h1Home,
      h1Away,
      h2Home,
      h2Away,
      totalGoals,
      d1: h1Home === h1Away,
      d2: h2Home === h2Away,
      weight: histSeasonWeight(r.season, currentSeason),
    });
  }
  return out;
}

export function fitLeagueHalfParamsFromRows(
  leagueId: number,
  leagueName: string,
  compType: "league" | "cup",
  derived: DerivedHalfGoals[]
): LeagueHalfParams {
  const nValid = derived.length;
  let wSum = 0;
  let wH1 = 0;
  let wTot = 0;
  let wH1Home = 0;
  let wHomeTot = 0;
  let wH1Away = 0;
  let wAwayTot = 0;
  let wD1 = 0;
  let wD2 = 0;
  let wD1D2 = 0;
  let wGoals = 0;
  let wGoalsSq = 0;
  let nHomeGoalsSample = 0;
  let nAwayGoalsSample = 0;

  for (const r of derived) {
    const w = r.weight;
    wSum += w;
    const h1Tot = r.h1Home + r.h1Away;
    wH1 += w * h1Tot;
    wTot += w * r.totalGoals;
    const homeTot = r.h1Home + r.h2Home;
    const awayTot = r.h1Away + r.h2Away;
    wH1Home += w * r.h1Home;
    wHomeTot += w * homeTot;
    wH1Away += w * r.h1Away;
    wAwayTot += w * awayTot;
    if (homeTot > 0) nHomeGoalsSample += 1;
    if (awayTot > 0) nAwayGoalsSample += 1;
    if (r.d1) wD1 += w;
    if (r.d2) wD2 += w;
    if (r.d1 && r.d2) wD1D2 += w;
    wGoals += w * r.totalGoals;
    wGoalsSq += w * r.totalGoals * r.totalGoals;
  }

  const s1Combined = wTot > 0 ? wH1 / wTot : 0.5;
  let s1Home = wHomeTot > 0 ? wH1Home / wHomeTot : s1Combined;
  let s1Away = wAwayTot > 0 ? wH1Away / wAwayTot : s1Combined;
  let usedCombinedShareHome = false;
  let usedCombinedShareAway = false;
  if (nHomeGoalsSample < HALF_SHARE_SIDE_MIN_SAMPLE) {
    s1Home = s1Combined;
    usedCombinedShareHome = true;
  }
  if (nAwayGoalsSample < HALF_SHARE_SIDE_MIN_SAMPLE) {
    s1Away = s1Combined;
    usedCombinedShareAway = true;
  }

  // Clamp shares into (0,1) only as numerical safety when totals are zero.
  const clampShare = (s: number) =>
    Number.isFinite(s) ? Math.min(0.999, Math.max(0.001, s)) : 0.5;

  const pD1Obs = wSum > 0 ? wD1 / wSum : 0;
  const pD2Obs = wSum > 0 ? wD2 / wSum : 0;
  const pD1d2Obs = wSum > 0 ? wD1D2 / wSum : 0;
  const denom = pD1Obs * pD2Obs;
  const kappaRaw = denom > 1e-12 ? pD1d2Obs / denom : 1;
  const n = nValid;
  const kappaAdj = (n * kappaRaw + KAPPA_SHRINKAGE_M) / (n + KAPPA_SHRINKAGE_M);

  const goalsMean = wSum > 0 ? wGoals / wSum : null;
  const goalsVariance =
    wSum > 0 && goalsMean != null
      ? Math.max(0, wGoalsSq / wSum - goalsMean * goalsMean)
      : null;
  const goalsDispersion =
    goalsMean != null && goalsMean > 0 && goalsVariance != null
      ? goalsVariance / goalsMean
      : null;
  const goalsDistribution =
    goalsDispersion != null
      ? chooseGoalsDistribution(goalsDispersion)
      : "poisson";

  return {
    leagueId,
    compType,
    leagueName,
    s1: clampShare(s1Combined),
    s1Home: clampShare(s1Home),
    s1Away: clampShare(s1Away),
    usedCombinedShareHome,
    usedCombinedShareAway,
    nValid,
    nHomeGoalsSample,
    nAwayGoalsSample,
    kappaRaw,
    kappaAdj,
    pD1Obs,
    pD2Obs,
    pD1d2Obs,
    goalsMean,
    goalsVariance,
    goalsDispersion,
    goalsDistribution,
    computedAt: new Date().toISOString(),
  };
}

export async function fitAndPersistHalfParams(): Promise<LeagueHalfParams[]> {
  const db = await getDb();
  const minSeason = histWindowMinSeason();
  const { currentHistSeason } = await import("./seasons");
  const current = currentHistSeason();

  const results: LeagueHalfParams[] = [];
  const leagueIds = HIST_LEAGUES.map((l) => l.id);

  const allRows = await db
    .select({
      fixtureId: histFixtures.fixtureId,
      leagueId: histFixtures.leagueId,
      season: histFixtures.season,
      compType: histFixtures.compType,
      htHome: histFixtures.htHome,
      htAway: histFixtures.htAway,
      ftHome: histFixtures.ftHome,
      ftAway: histFixtures.ftAway,
    })
    .from(histFixtures)
    .where(
      and(
        inArray(histFixtures.leagueId, leagueIds),
        gte(histFixtures.season, minSeason),
        isNotNull(histFixtures.htHome),
        isNotNull(histFixtures.htAway),
        isNotNull(histFixtures.ftHome),
        isNotNull(histFixtures.ftAway),
        sql`${histFixtures.status} in ('FT','AET','PEN')`
      )
    );

  for (const league of HIST_LEAGUES) {
    // Domestics: exclude cup-tagged rows. Cups: only that competition's rows
    // (UCL fixtures are stored under league_id=2; never borrow domestic shares).
    const typed = allRows.filter((r) => {
      if (r.leagueId !== league.id) return false;
      if (league.type === "cup") return true;
      return r.compType !== "cup";
    });

    const fixtureRows: HalfFixtureRow[] = typed
      .filter(
        (r) =>
          r.htHome != null &&
          r.htAway != null &&
          r.ftHome != null &&
          r.ftAway != null
      )
      .map((r) => ({
        fixtureId: r.fixtureId,
        season: r.season,
        htHome: r.htHome!,
        htAway: r.htAway!,
        ftHome: r.ftHome!,
        ftAway: r.ftAway!,
      }));

    const derived = deriveHalfGoals(fixtureRows, current);
    const fitted = fitLeagueHalfParamsFromRows(
      league.id,
      league.name,
      league.type,
      derived
    );
    if (fitted.nValid < DIEH_MIN_VALID_FIXTURES) {
      console.warn(
        `[fit-half-params] ${league.name} (${league.type}): n_valid=${fitted.nValid} < ${DIEH_MIN_VALID_FIXTURES} — DIEH will show insufficient-data`
      );
    }
    results.push(fitted);
  }

  await saveHalfParamsRows(results);
  return results;
}

/** Refit when empty or older than maxAgeMs (default 24h). */
export async function maybeRefitHalfParams(
  maxAgeMs = 24 * 60 * 60 * 1000
): Promise<{ refit: boolean; n: number }> {
  const { loadHalfParamsStore, halfParamsAreStale, setCachedHalfParams } =
    await import("./half-params");
  const store = await loadHalfParamsStore();
  if (!halfParamsAreStale(store, maxAgeMs)) {
    setCachedHalfParams(store);
    return { refit: false, n: store.leagues.length };
  }
  const rows = await fitAndPersistHalfParams();
  return { refit: true, n: rows.length };
}
