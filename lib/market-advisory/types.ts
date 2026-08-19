import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { AnalysisHistory } from "@/lib/prediction-log/types";
import type { BinCalibrator } from "@/lib/predictor/calibration";
import type { MarketFamilyId } from "@/lib/slip-builder/types";

/** MSAM conflict groups for diversification. */
export type MsamConflictGroup =
  | "RESULT_MARGIN"
  | "TOTAL_GOALS"
  | "TEAM_GOALS"
  | "BTTS_GOALS"
  | "HALF_STRUCTURE"
  | "CORNERS"
  | "COMBO";

export type IneligibilityReasonCode =
  | "INSUFFICIENT_HT_HISTORY"
  | "CORNERS_MODEL_UNAVAILABLE"
  | "LOW_CALIBRATION_SAMPLE"
  | "UNRESOLVED_FIXTURE_IDENTITY"
  | "PROBABILITY_INTEGRITY_FAILURE"
  | "HIGH_PARAMETER_SENSITIVITY"
  | "INSUFFICIENT_SAMPLE"
  | "SPECIALIST_MODEL_UNAVAILABLE"
  | "MARKET_UNAVAILABLE"
  | "FIXTURE_CANCELLED"
  | "DATA_INCOMPLETE";

export type AdvisoryRunStatus =
  | "complete"
  | "partial"
  | "failed_integrity"
  | "insufficient_data";

export type SelectionRole = "primary" | "alternative" | "rejected";

export type AgreementStatus =
  | "Strong Agreement"
  | "MSAM Lead"
  | "Existing Method Lead"
  | "Conflict / Review"
  | "Insufficient Data";

export type AdvisoryTier = "Strong" | "Usable" | "Caution" | "Insufficient Data";

export type EmsKind = "decision_maker" | "weekend_picks";

/** Stable market code: FAMILY:selectionKey[:line] */
export type MarketCode = string;

export type SourceCoverageSnapshot = {
  targetApiWeight: number;
  targetSystemWeight: number;
  effectiveApiWeight: number;
  effectiveSystemWeight: number;
  qApi: number;
  qSystem: number;
  apiRecordCount: number | null;
  systemRecordCount: number | null;
  effectiveSampleSize: number;
  sourceBreakdown: string;
  exclusionCount: number;
  exclusionReasons: string[];
};

export type CanonicalProposition = {
  marketCode: MarketCode;
  marketFamily: MarketFamilyId;
  conflictGroup: MsamConflictGroup;
  selectionKey: string;
  selectionLabel: string;
  line?: number;
  comboId?: string;
  rawProbability: number;
  calibratedProbability: number;
  probabilityLower: number | null;
  probabilityUpper: number | null;
  calibrated: boolean;
  coherenceOk: boolean;
  nEffective: number;
  marketDefinition: Record<string, unknown>;
};

export type QualityDimensions = {
  ops: number;
  cqs: number;
  ecs: number;
  sss: number;
  iss: number;
  dis: number;
};

export type MsamCandidate = CanonicalProposition & {
  eligible: boolean;
  ineligibilityReasonCodes: IneligibilityReasonCode[];
  dimensions: QualityDimensions;
  msamScore: number;
  sourceCoverage: SourceCoverageSnapshot;
  diagnosticSnapshot: Record<string, unknown>;
  explanationSnapshot: Record<string, unknown>;
};

export type EmsCandidate = {
  marketCode: MarketCode;
  marketLabel: string;
  prediction: string;
  emsScore: number;
  emsConfidence: number;
  existingRank: number;
};

export type EmsSnapshot = {
  kind: EmsKind;
  candidates: EmsCandidate[];
  snapshotVersion: string;
};

export type ScoredMsamCandidate = MsamCandidate & {
  msamNormalizedScore: number;
  existingNormalizedScore: number | null;
  finalAdvisoryScore: number | null;
  agreementStatus: AgreementStatus;
  selectionRole: SelectionRole;
  primaryRank: number | null;
};

export type MarketAdvisoryRunResult = {
  advisoryRunId: string;
  fixtureId: number;
  matchId: string;
  generatedAt: string;
  predictionCutoffAt: string;
  msamModelVersion: string;
  collaborationPolicyVersion: string;
  dataPolicyVersion: string;
  status: AdvisoryRunStatus;
  inputLineageHash: string;
  integrityFailures: string[];
  sourceCoverageSummary: SourceCoverageSnapshot;
  candidates: ScoredMsamCandidate[];
  primary: ScoredMsamCandidate[];
  alternatives: ScoredMsamCandidate[];
  rejected: ScoredMsamCandidate[];
  warnings: string[];
  cqsBootstrap: boolean;
  normalizationBootstrap: boolean;
  emsSnapshot: EmsSnapshot;
};

export type RunMarketAdvisoryInput = {
  fixtureId: number;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffIso?: string;
  cfe: CanonicalFixtureEstimate;
  emsSnapshot: EmsSnapshot;
  emsKind: EmsKind;
  analysis: AnalysisHistory | null;
  calibrator: BinCalibrator | null;
  cqsBootstrap: boolean;
  predictionCutoffAt: string;
  fixtureIdentityOk?: boolean;
  fixtureCancelled?: boolean;
};

/** UI-facing payload (serializable). */
export type MarketAdvisoryUiPayload = {
  beta: true;
  runId: string;
  fixtureId: number;
  status: AdvisoryRunStatus;
  generatedAt: string;
  sourceCoverage: { apiPct: number; systemPct: number; label: string };
  cqsBootstrap: boolean;
  warnings: string[];
  primary: Array<{
    rank: number;
    marketLabel: string;
    prediction: string;
    probabilityPct: number;
    tier: AdvisoryTier;
    msamScore: number;
    finalAdvisoryScore: number | null;
    conflictGroup: MsamConflictGroup;
    agreementStatus: AgreementStatus;
    explanation: string;
    dimensions: QualityDimensions;
    expandable: Record<string, unknown>;
  }>;
  alternatives: Array<{
    marketLabel: string;
    prediction: string;
    probabilityPct: number;
    overlapNote?: string;
  }>;
  ineligibleNotes: string[];
};
