import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { AnalysisHistory } from "@/lib/prediction-log/types";
import type { BinCalibrator } from "@/lib/predictor/calibration";
import { fitSlipCalibrator } from "@/lib/slip-builder/slip-calibration";
import type { EmsSnapshot } from "./types";
import { runMarketAdvisory, toUiPayload } from "./run-msam";
import { persistMarketAdvisoryRun } from "./persist";
import type {
  MarketAdvisoryRunResult,
  MarketAdvisoryUiPayload,
} from "./types";

export type RunAdvisoryForFixtureInput = {
  fixtureId: number;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffIso?: string;
  cfe: CanonicalFixtureEstimate;
  emsSnapshot: EmsSnapshot;
  emsKind: "decision_maker" | "weekend_picks";
  allBatches: import("@/lib/prediction-log/types").PredictionBatch[];
  analysis: AnalysisHistory | null;
  bayesianLog?: import("@/lib/prediction-log/bayesian-calibration").BayesianCalibrationLog | null;
  persist?: boolean;
};

export function executeMarketAdvisory(
  input: RunAdvisoryForFixtureInput
): MarketAdvisoryRunResult {
  const calibrator = fitSlipCalibrator(input.allBatches, input.bayesianLog ?? null);
  const cutoff =
    input.kickoffIso ?? new Date().toISOString();

  const result = runMarketAdvisory({
    fixtureId: input.fixtureId,
    matchId: input.matchId,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    league: input.league,
    kickoffIso: input.kickoffIso,
    cfe: input.cfe,
    emsSnapshot: input.emsSnapshot,
    emsKind: input.emsKind,
    analysis: input.analysis,
    calibrator,
    cqsBootstrap: true,
    predictionCutoffAt: cutoff,
    fixtureIdentityOk: input.fixtureId > 0,
  });

  if (input.persist !== false) {
    void persistMarketAdvisoryRun(result);
  }

  return result;
}

export function executeAndSerialize(
  input: RunAdvisoryForFixtureInput
): { result: MarketAdvisoryRunResult; ui: MarketAdvisoryUiPayload } {
  const result = executeMarketAdvisory(input);
  return { result, ui: toUiPayload(result) };
}
