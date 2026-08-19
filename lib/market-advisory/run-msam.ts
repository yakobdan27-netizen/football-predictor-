import { createHash } from "crypto";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import {
  buildCanonicalProbabilitySnapshot,
} from "./canonical-probability-adapter";
import { applyCollaboration } from "./collaboration";
import {
  COLLABORATION_POLICY_VERSION,
  DATA_POLICY_VERSION,
  MSAM_MODEL_VERSION,
} from "./config";
import { scoreCandidate } from "./eligibility";
import { buildExplanation, formatMarketDisplay, ineligibleNote } from "./explain";
import { runIntegrityGate } from "./integrity-gate";
import {
  assignSelectionRoles,
  selectDiversifiedCandidates,
} from "./selection-optimizer";
import { coverageLabel } from "./source-coverage";
import type {
  MarketAdvisoryRunResult,
  MarketAdvisoryUiPayload,
  RunMarketAdvisoryInput,
  ScoredMsamCandidate,
} from "./types";

function lineageHash(input: RunMarketAdvisoryInput): string {
  const payload = JSON.stringify({
    fixtureId: input.fixtureId,
    matchId: input.matchId,
    cutoff: input.predictionCutoffAt,
    model: input.cfe.model_params_version,
    ess: input.cfe.provenance.ess,
    ems: input.emsSnapshot.snapshotVersion,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function runMarketAdvisory(
  input: RunMarketAdvisoryInput
): MarketAdvisoryRunResult {
  const gate = runIntegrityGate(input.cfe);
  const snapshot = buildCanonicalProbabilitySnapshot({
    cfe: input.cfe,
    calibrator: input.calibrator,
  });

  const msamCandidates = snapshot.propositions.map((prop) => {
    const c = scoreCandidate({
      prop,
      cfe: input.cfe,
      snapshot,
      calibrator: input.calibrator,
      analysis: input.analysis,
      cqsBootstrap: input.cqsBootstrap,
      fixtureIdentityOk: input.fixtureIdentityOk !== false,
      fixtureCancelled: input.fixtureCancelled === true,
    });
    c.explanationSnapshot = { text: buildExplanation(c) };
    return c;
  });

  const { primary, alternatives, rejected, warnings } =
    selectDiversifiedCandidates(msamCandidates);

  const { scored, normalizationBootstrap } = applyCollaboration({
    candidates: msamCandidates,
    emsSnapshot: input.emsSnapshot,
    primary,
  });

  const finalScored = assignSelectionRoles(primary, alternatives, rejected, scored);

  finalScored.forEach((c) => {
    if (c.selectionRole === "primary" || c.selectionRole === "alternative") {
      c.explanationSnapshot = { text: buildExplanation(c) };
    }
  });

  const status =
    !gate.passed
      ? "failed_integrity"
      : primary.length === 0
        ? "insufficient_data"
        : primary.length < 3
          ? "partial"
          : "complete";

  const ineligibleCodes = new Set<string>();
  msamCandidates
    .filter((c) => !c.eligible)
    .forEach((c) => c.ineligibilityReasonCodes.forEach((r) => ineligibleCodes.add(r)));

  if (ineligibleCodes.has("INSUFFICIENT_HT_HISTORY")) {
    warnings.push(ineligibleNote("INSUFFICIENT_HT_HISTORY"));
  }
  if (ineligibleCodes.has("CORNERS_MODEL_UNAVAILABLE")) {
    warnings.push(ineligibleNote("CORNERS_MODEL_UNAVAILABLE"));
  }

  const runId = `mar-${input.fixtureId}-${Date.now()}`;

  return {
    advisoryRunId: runId,
    fixtureId: input.fixtureId,
    matchId: input.matchId,
    generatedAt: new Date().toISOString(),
    predictionCutoffAt: input.predictionCutoffAt,
    msamModelVersion: MSAM_MODEL_VERSION,
    collaborationPolicyVersion: COLLABORATION_POLICY_VERSION,
    dataPolicyVersion: DATA_POLICY_VERSION,
    status,
    inputLineageHash: lineageHash(input),
    integrityFailures: gate.checks.filter((c) => !c.ok).map((c) => c.code),
    sourceCoverageSummary: snapshot.sourceCoverage,
    candidates: finalScored,
    primary: finalScored.filter((c) => c.selectionRole === "primary"),
    alternatives: finalScored.filter((c) => c.selectionRole === "alternative"),
    rejected: finalScored.filter((c) => c.selectionRole === "rejected"),
    warnings,
    cqsBootstrap: input.cqsBootstrap,
    normalizationBootstrap,
    emsSnapshot: input.emsSnapshot,
  };
}

export function toUiPayload(result: MarketAdvisoryRunResult): MarketAdvisoryUiPayload {
  const cov = result.sourceCoverageSummary;
  return {
    beta: true,
    runId: result.advisoryRunId,
    fixtureId: result.fixtureId,
    status: result.status,
    generatedAt: result.generatedAt,
    sourceCoverage: {
      apiPct: Math.round(cov.effectiveApiWeight * 100),
      systemPct: Math.round(cov.effectiveSystemWeight * 100),
      label: coverageLabel(cov),
    },
    cqsBootstrap: result.cqsBootstrap,
    warnings: result.warnings,
    primary: result.primary.map((c) => {
      const display = formatMarketDisplay(c);
      return {
        rank: c.primaryRank ?? 0,
        marketLabel: display.marketLabel,
        prediction: display.prediction,
        probabilityPct: Math.round(c.calibratedProbability * 1000) / 10,
        tier: tierFromCandidate(c),
        msamScore: Math.round(c.msamScore * 10) / 10,
        finalAdvisoryScore:
          c.finalAdvisoryScore != null
            ? Math.round(c.finalAdvisoryScore * 10) / 10
            : null,
        conflictGroup: c.conflictGroup,
        agreementStatus: c.agreementStatus,
        explanation: String(c.explanationSnapshot.text ?? buildExplanation(c)),
        dimensions: c.dimensions,
        expandable: {
          rawProbability: c.rawProbability,
          calibrated: c.calibrated,
          diagnostic: c.diagnosticSnapshot,
          sourceCoverage: c.sourceCoverage,
        },
      };
    }),
    alternatives: result.alternatives.map((c) => {
      const display = formatMarketDisplay(c);
      return {
        marketLabel: display.marketLabel,
        prediction: display.prediction,
        probabilityPct: Math.round(c.calibratedProbability * 1000) / 10,
        overlapNote: "Overlaps primary conflict group or lower MSAM rank.",
      };
    }),
    ineligibleNotes: [
      ...new Set(
        result.rejected
          .flatMap((c) => c.ineligibilityReasonCodes)
          .map(ineligibleNote)
      ),
    ],
  };
}

function tierFromCandidate(
  c: ScoredMsamCandidate
): "Strong" | "Usable" | "Caution" | "Insufficient Data" {
  if (!c.eligible) return "Insufficient Data";
  if (c.agreementStatus === "Strong Agreement" && (c.finalAdvisoryScore ?? 0) >= 70) {
    return "Strong";
  }
  if ((c.finalAdvisoryScore ?? c.msamScore) >= 55) return "Usable";
  if ((c.finalAdvisoryScore ?? c.msamScore) >= 40) return "Caution";
  return "Insufficient Data";
}
