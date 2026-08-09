/**
 * Rebuild pools + rho lookup for swap / manual-add mutations.
 */
import type { PredictionBatch } from "@/lib/prediction-log/types";
import type { BayesianCalibrationLog } from "@/lib/prediction-log/bayesian-calibration";
import { loadBatchFixturePool } from "./batch-pool";
import { buildCandidatePools, type FamilyPool } from "./candidate-pool";
import { buildRhoLookup, heuristicLookup } from "./hist-cooccurrence";
import { fitSlipCalibrator } from "./slip-calibration";
import type { RhoLookup } from "./correlation";
import type { SlipPreferences } from "./types";

export async function buildMutationContext(input: {
  allBatches: PredictionBatch[];
  prefs: SlipPreferences;
  bayesianLog?: BayesianCalibrationLog | null;
  useHeuristicRho?: boolean;
}): Promise<{ byFamily: FamilyPool[]; rhoLookup: RhoLookup }> {
  const fixtures = loadBatchFixturePool(input.allBatches, input.prefs);
  const calibrator = fitSlipCalibrator(
    input.allBatches,
    input.bayesianLog ?? null
  );
  const pools = buildCandidatePools({
    fixtures,
    prefs: input.prefs,
    calibrator,
  });
  const allLegs = pools.byFamily.flatMap((p) => p.eligible);
  const rhoLookup = input.useHeuristicRho
    ? heuristicLookup()
    : await buildRhoLookup({
        legs: allLegs,
        competitions:
          input.prefs.competitions.length > 0
            ? input.prefs.competitions
            : undefined,
      });
  return { byFamily: pools.byFamily, rhoLookup };
}
