/**
 * Persist fitted model params (ρ, corner dispersion) on hist_meta.model_params_json.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { histMeta } from "@/lib/db/schema";
import {
  CORNER_DISPERSION_NB_THRESHOLD,
  MODEL_PARAMS_VERSION,
} from "@/lib/prediction-log/model-config";

export type CornerDistChoice = "poisson" | "negbin";

export type LeagueCornerDispersion = {
  leagueId: number;
  leagueName: string;
  mean: number;
  variance: number;
  dispersion: number;
  distribution: CornerDistChoice;
  n: number;
};

export type ModelParamsStore = {
  version: string;
  fittedAt: string;
  rho: number;
  rhoSampleSize: number;
  cornerDispersion: LeagueCornerDispersion[];
  halfLambdas?: Array<{
    leagueId: number;
    leagueName: string;
    lambda1h: number;
    lambda2h: number;
    lambdaFt: number;
  }>;
};

const DEFAULT_RHO = -0.13;

export function defaultModelParams(): ModelParamsStore {
  return {
    version: MODEL_PARAMS_VERSION,
    fittedAt: new Date(0).toISOString(),
    rho: DEFAULT_RHO,
    rhoSampleSize: 0,
    cornerDispersion: [],
  };
}

export async function loadModelParams(): Promise<ModelParamsStore> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(histMeta)
    .where(eq(histMeta.id, 1))
    .limit(1);
  if (!row?.modelParamsJson) return defaultModelParams();
  try {
    const parsed = JSON.parse(row.modelParamsJson) as ModelParamsStore;
    if (!Number.isFinite(parsed.rho)) return defaultModelParams();
    return { ...defaultModelParams(), ...parsed };
  } catch {
    return defaultModelParams();
  }
}

export async function saveModelParams(params: ModelParamsStore): Promise<void> {
  const db = await getDb();
  const now = new Date();
  const json = JSON.stringify(params);
  await db
    .insert(histMeta)
    .values({
      id: 1,
      updatedAt: now,
      modelParamsJson: json,
    })
    .onConflictDoUpdate({
      target: histMeta.id,
      set: {
        updatedAt: now,
        modelParamsJson: json,
      },
    });
}

export function chooseCornerDistribution(
  dispersion: number
): CornerDistChoice {
  return dispersion > CORNER_DISPERSION_NB_THRESHOLD ? "negbin" : "poisson";
}
