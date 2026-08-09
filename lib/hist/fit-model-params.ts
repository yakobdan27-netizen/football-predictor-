/**
 * Fit Dixon–Coles ρ and corner dispersion on the 11-season hist window.
 */
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { histFixtures, histStats } from "@/lib/db/schema";
import { poissonPmf } from "@/lib/predictor/poisson";
import { tau } from "@/lib/predictor/score-matrix";
import { MODEL_PARAMS_VERSION } from "@/lib/prediction-log/model-config";
import {
  HIST_DOMESTIC_LEAGUES,
  HIST_LEAGUES,
  histWindowMinSeason,
} from "./seasons";
import {
  chooseCornerDistribution,
  saveModelParams,
  type LeagueCornerDispersion,
  type ModelParamsStore,
} from "./model-params";

function dcLogLik(
  rows: Array<{ hg: number; ag: number }>,
  lambdaH: number,
  lambdaA: number,
  rho: number
): number {
  let ll = 0;
  for (const r of rows) {
    const h = Math.min(9, Math.max(0, r.hg));
    const a = Math.min(9, Math.max(0, r.ag));
    const base = poissonPmf(h, lambdaH) * poissonPmf(a, lambdaA) * tau(h, a, lambdaH, lambdaA, rho);
    ll += Math.log(Math.max(base, 1e-15));
  }
  return ll;
}

/** Grid-search ρ on domestic FT scorelines using league-mean λs. */
export async function fitDixonColesRho(): Promise<{
  rho: number;
  sampleSize: number;
}> {
  const db = await getDb();
  const minSeason = histWindowMinSeason();
  const leagueIds = HIST_DOMESTIC_LEAGUES.map((l) => l.id);

  const rows = await db
    .select({
      hg: histFixtures.ftHome,
      ag: histFixtures.ftAway,
    })
    .from(histFixtures)
    .where(
      and(
        inArray(histFixtures.leagueId, leagueIds),
        eq(histFixtures.compType, "league"),
        gte(histFixtures.season, minSeason),
        isNotNull(histFixtures.ftHome),
        isNotNull(histFixtures.ftAway),
        sql`${histFixtures.status} in ('FT','AET','PEN')`
      )
    );

  const sample = rows
    .filter((r) => r.hg != null && r.ag != null)
    .map((r) => ({ hg: r.hg!, ag: r.ag! }));

  if (sample.length < 50) {
    return { rho: -0.13, sampleSize: sample.length };
  }

  const meanH =
    sample.reduce((s, r) => s + r.hg, 0) / sample.length;
  const meanA =
    sample.reduce((s, r) => s + r.ag, 0) / sample.length;

  let bestRho = -0.13;
  let bestLl = -Infinity;
  for (let rho = -0.25; rho <= 0.05; rho += 0.01) {
    const ll = dcLogLik(sample, meanH, meanA, rho);
    if (ll > bestLl) {
      bestLl = ll;
      bestRho = rho;
    }
  }
  return { rho: Math.round(bestRho * 100) / 100, sampleSize: sample.length };
}

export async function measureCornerDispersion(): Promise<
  LeagueCornerDispersion[]
> {
  const db = await getDb();
  const minSeason = histWindowMinSeason();
  const out: LeagueCornerDispersion[] = [];

  for (const league of HIST_LEAGUES) {
    const rows = await db
      .select({
        corners: histStats.corners,
      })
      .from(histStats)
      .innerJoin(
        histFixtures,
        eq(histStats.fixtureId, histFixtures.fixtureId)
      )
      .where(
        and(
          eq(histFixtures.leagueId, league.id),
          gte(histFixtures.season, minSeason),
          isNotNull(histStats.corners)
        )
      );

    const vals = rows
      .map((r) => r.corners)
      .filter((c): c is number => c != null && Number.isFinite(c));
    if (vals.length < 20) {
      out.push({
        leagueId: league.id,
        leagueName: league.name,
        mean: 0,
        variance: 0,
        dispersion: 1,
        distribution: "poisson",
        n: vals.length,
      });
      continue;
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance =
      vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const dispersion = mean > 0 ? variance / mean : 1;
    out.push({
      leagueId: league.id,
      leagueName: league.name,
      mean,
      variance,
      dispersion,
      distribution: chooseCornerDistribution(dispersion),
      n: vals.length,
    });
  }
  return out;
}

export async function measureHalfLambdas(): Promise<
  NonNullable<ModelParamsStore["halfLambdas"]>
> {
  const db = await getDb();
  const minSeason = histWindowMinSeason();
  const out: NonNullable<ModelParamsStore["halfLambdas"]> = [];

  for (const league of HIST_DOMESTIC_LEAGUES) {
    const [row] = await db
      .select({
        n: sql<number>`count(*)::int`,
        ht: sql<number>`avg((${histFixtures.htHome} + ${histFixtures.htAway}))::float`,
        ft: sql<number>`avg((${histFixtures.ftHome} + ${histFixtures.ftAway}))::float`,
      })
      .from(histFixtures)
      .where(
        and(
          eq(histFixtures.leagueId, league.id),
          eq(histFixtures.compType, "league"),
          gte(histFixtures.season, minSeason),
          isNotNull(histFixtures.htHome),
          isNotNull(histFixtures.htAway),
          isNotNull(histFixtures.ftHome),
          isNotNull(histFixtures.ftAway)
        )
      );

    const n = Number(row?.n ?? 0);
    if (n < 20) continue;
    const lambda1h = Number(row?.ht ?? 0);
    const lambdaFt = Number(row?.ft ?? 0);
    const lambda2h = Math.max(0, lambdaFt - lambda1h);
    out.push({
      leagueId: league.id,
      leagueName: league.name,
      lambda1h,
      lambda2h,
      lambdaFt,
    });
  }
  return out;
}

export async function fitAndPersistModelParams(): Promise<ModelParamsStore> {
  const { rho, sampleSize } = await fitDixonColesRho();
  const cornerDispersion = await measureCornerDispersion();
  const halfLambdas = await measureHalfLambdas();
  const store: ModelParamsStore = {
    version: MODEL_PARAMS_VERSION,
    fittedAt: new Date().toISOString(),
    rho,
    rhoSampleSize: sampleSize,
    cornerDispersion,
    halfLambdas,
  };
  await saveModelParams(store);
  return store;
}
