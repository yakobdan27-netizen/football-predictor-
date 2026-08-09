/**
 * End-to-end slip batch generation from saved prediction batches.
 */
import type { PredictionBatch } from "@/lib/prediction-log/types";
import type { BayesianCalibrationLog } from "@/lib/prediction-log/bayesian-calibration";
import { loadBatchFixturePool } from "./batch-pool";
import { buildCandidatePools } from "./candidate-pool";
import { buildRhoLookup, heuristicLookup } from "./hist-cooccurrence";
import { optimizeSlipBatch, type OptimizeInput } from "./optimizer";
import { fitSlipCalibrator } from "./slip-calibration";
import type { SlipBatchResult, SlipPreferences } from "./types";
import { DEFAULT_SLIP_PREFERENCES } from "./types";

export function mergePreferences(
  partial?: Partial<SlipPreferences> | null
): SlipPreferences {
  const base = { ...DEFAULT_SLIP_PREFERENCES, ...(partial ?? {}) };
  if (!base.windowStart || !base.windowEnd) {
    const now = new Date();
    base.windowStart = base.windowStart || now.toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    base.windowEnd = base.windowEnd || end.toISOString().slice(0, 10);
  }
  return base;
}

export async function generateSlipBatch(input: {
  allBatches: PredictionBatch[];
  preferences?: Partial<SlipPreferences> | null;
  excludeFixtureIds?: string[];
  bayesianLog?: BayesianCalibrationLog | null;
  batchId?: string;
  batchNumber?: number;
  /** Skip hist DB for tests / offline. */
  useHeuristicRho?: boolean;
}): Promise<SlipBatchResult> {
  const prefs = mergePreferences(input.preferences);
  // Q9 must never influence computation — strip before optimise path is already record-only
  const prefsForEngine: SlipPreferences = { ...prefs };

  const fixtures = loadBatchFixturePool(input.allBatches, prefsForEngine, {
    excludeFixtureIds: input.excludeFixtureIds,
  });

  const calibrator = fitSlipCalibrator(
    input.allBatches,
    input.bayesianLog ?? null
  );

  const pools = buildCandidatePools({
    fixtures,
    prefs: prefsForEngine,
    calibrator,
  });

  if (pools.familyError) {
    return {
      batchId: input.batchId ?? "local",
      batchNumber: input.batchNumber ?? 0,
      generatedAt: new Date().toISOString(),
      preferences: prefs,
      slips: [],
      filtered: [],
      partialReason: pools.familyError,
      fixtureExclusionIds: input.excludeFixtureIds ?? [],
    };
  }

  const allLegs = pools.byFamily.flatMap((p) => p.eligible);
  const rhoLookup = input.useHeuristicRho
    ? heuristicLookup()
    : await buildRhoLookup({
        legs: allLegs,
        competitions:
          prefs.competitions.length > 0 ? prefs.competitions : undefined,
      });

  const optInput: OptimizeInput = {
    prefs: prefsForEngine,
    byFamily: pools.byFamily,
    allFiltered: pools.allFiltered,
    rhoLookup,
    batchId: input.batchId,
    batchNumber: input.batchNumber,
    excludeFixtureIds: input.excludeFixtureIds,
  };

  const result = optimizeSlipBatch(optInput);
  // Restore user note on preferences (engine ignored it)
  return { ...result, preferences: prefs };
}
