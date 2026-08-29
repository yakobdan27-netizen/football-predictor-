import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { AnalysisHistory } from "@/lib/prediction-log/types";
import type { BinCalibrator } from "@/lib/predictor/calibration";
import type { ScoredLeg } from "@/lib/match-centre/weekend-opportunities";
import {
  buildCanonicalProbabilitySnapshot,
  findProposition,
} from "./canonical-probability-adapter";
import { applyCollaboration, advisoryTier } from "./collaboration";
import { scoreCandidate } from "./eligibility";
import { snapshotWeekendPortfolioEms } from "./ems-adapters/weekend-portfolio";
import type { AgreementStatus, AdvisoryTier, IneligibilityReasonCode } from "./types";

export type PortfolioCollaborativeScore = {
  marketCode: string;
  leg: ScoredLeg;
  pRaw: number;
  pCalibrated: number;
  msamScore: number;
  msamNormalizedScore: number | null;
  existingNormalizedScore: number | null;
  emsRawScore: number;
  finalAdvisoryScore: number | null;
  agreementStatus: AgreementStatus;
  advisoryStatus: AdvisoryTier;
  msamEligible: boolean;
  ineligibilityReasons: IneligibilityReasonCode[];
};

export function scorePortfolioProposition(input: {
  cfe: CanonicalFixtureEstimate;
  calibrator: BinCalibrator | null;
  analysis: AnalysisHistory | null;
  leg: ScoredLeg;
  marketCode: string;
  fixtureIdentityOk?: boolean;
}): PortfolioCollaborativeScore | null {
  const { cfe, calibrator, analysis, leg, marketCode } = input;
  const emsRawScore = 100 * leg.pCalibrated;
  if (!Number.isFinite(emsRawScore)) return null;

  const snapshot = buildCanonicalProbabilitySnapshot({ cfe, calibrator });
  const prop = findProposition(snapshot, marketCode);
  if (!prop) return null;

  const msamCandidates = snapshot.propositions.map((p) =>
    scoreCandidate({
      prop: p,
      cfe,
      snapshot,
      calibrator,
      analysis,
      cqsBootstrap: true,
      fixtureIdentityOk: input.fixtureIdentityOk !== false,
      fixtureCancelled: false,
    })
  );

  const target = msamCandidates.find((c) => c.marketCode === marketCode);
  if (!target) return null;

  const emsSnapshot = snapshotWeekendPortfolioEms(leg, marketCode);
  const primary = target.eligible ? [target] : [];

  const { scored } = applyCollaboration({
    candidates: msamCandidates,
    emsSnapshot,
    primary,
  });

  const hit = scored.find((c) => c.marketCode === marketCode);
  if (!hit) return null;

  let finalAdvisoryScore = hit.finalAdvisoryScore;
  let agreementStatus = hit.agreementStatus;

  if (finalAdvisoryScore == null && Number.isFinite(emsRawScore)) {
    finalAdvisoryScore = emsRawScore;
    agreementStatus = "Insufficient Data";
  }

  if (finalAdvisoryScore == null) return null;

  return {
    marketCode,
    leg,
    pRaw: prop.rawProbability,
    pCalibrated: prop.calibratedProbability,
    msamScore: hit.msamScore,
    msamNormalizedScore: hit.msamNormalizedScore,
    existingNormalizedScore: hit.existingNormalizedScore,
    emsRawScore,
    finalAdvisoryScore,
    agreementStatus,
    advisoryStatus: advisoryTier({ ...hit, finalAdvisoryScore }),
    msamEligible: hit.eligible,
    ineligibilityReasons: hit.ineligibilityReasonCodes,
  };
}
