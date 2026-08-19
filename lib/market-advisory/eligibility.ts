import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { AnalysisHistory } from "@/lib/prediction-log/types";
import type { BinCalibrator } from "@/lib/predictor/calibration";
import { MSAM_SCORE_WEIGHTS } from "./config";
import type { CanonicalProbabilitySnapshot } from "./canonical-probability-adapter";
import { buildSourceCoverage } from "./source-coverage";
import { scoreCqs } from "./scores/cqs";
import { scoreDis } from "./scores/dis";
import { scoreEcs } from "./scores/ecs";
import { scoreIss } from "./scores/iss";
import { scoreOps } from "./scores/ops";
import { scoreSss } from "./scores/sss";
import type {
  IneligibilityReasonCode,
  MsamCandidate,
  QualityDimensions,
} from "./types";

export function computeMsamScore(dim: QualityDimensions): number {
  return (
    MSAM_SCORE_WEIGHTS.ops * dim.ops +
    MSAM_SCORE_WEIGHTS.cqs * dim.cqs +
    MSAM_SCORE_WEIGHTS.ecs * dim.ecs +
    MSAM_SCORE_WEIGHTS.sss * dim.sss +
    MSAM_SCORE_WEIGHTS.iss * dim.iss +
    MSAM_SCORE_WEIGHTS.dis * dim.dis
  );
}

export function scoreCandidate(input: {
  prop: CanonicalProbabilitySnapshot["propositions"][number];
  cfe: CanonicalFixtureEstimate;
  snapshot: CanonicalProbabilitySnapshot;
  calibrator: BinCalibrator | null;
  analysis: AnalysisHistory | null;
  cqsBootstrap: boolean;
  fixtureIdentityOk: boolean;
  fixtureCancelled: boolean;
}): MsamCandidate {
  const reasons: IneligibilityReasonCode[] = [];
  const { prop, cfe, snapshot, calibrator, analysis, cqsBootstrap } = input;

  if (input.fixtureCancelled) reasons.push("FIXTURE_CANCELLED");
  if (!input.fixtureIdentityOk) reasons.push("UNRESOLVED_FIXTURE_IDENTITY");
  if (!snapshot.integrityPassed || !prop.coherenceOk) {
    reasons.push("PROBABILITY_INTEGRITY_FAILURE");
  }
  if (prop.nEffective < 5) reasons.push("INSUFFICIENT_SAMPLE");

  const halfFamilies = ["HALF_GOALS", "HSH", "HT_RESULT", "DIEH", "WIN_ONE_HALF"];
  if (
    halfFamilies.includes(prop.marketFamily) &&
    (cfe.coverage.ht_pct == null || cfe.coverage.ht_pct < 30)
  ) {
    reasons.push("INSUFFICIENT_HT_HISTORY");
  }
  if (
    (prop.marketFamily === "CORNERS" || prop.marketFamily === "SOT") &&
    (cfe.coverage.corners_pct == null || cfe.coverage.corners_pct < 25)
  ) {
    reasons.push("CORNERS_MODEL_UNAVAILABLE");
  }
  if (prop.marketFamily === "DIEH" && cfe.markets.dieh.status !== "ok") {
    reasons.push("SPECIALIST_MODEL_UNAVAILABLE");
  }

  const sss = scoreSss({ prop, cfe });
  if (sss.highSensitivity) reasons.push("HIGH_PARAMETER_SENSITIVITY");

  const cqsResult = scoreCqs({
    prop,
    calibrator,
    analysis,
    cqsBootstrap,
  });
  if (cqsResult.score < 20 && !cqsBootstrap) {
    reasons.push("LOW_CALIBRATION_SAMPLE");
  }

  const dimensions: QualityDimensions = {
    ops: scoreOps(prop),
    cqs: cqsResult.score,
    ecs: scoreEcs({ prop, cfe }),
    sss: sss.score,
    iss: scoreIss(prop),
    dis: scoreDis({ prop, cfe, fixtureIdentityOk: input.fixtureIdentityOk }),
  };

  const eligible = reasons.length === 0;

  const sourceCoverage = buildSourceCoverage(cfe);

  return {
    ...prop,
    eligible,
    ineligibilityReasonCodes: eligible ? [] : reasons,
    dimensions,
    msamScore: computeMsamScore(dimensions),
    sourceCoverage,
    diagnosticSnapshot: {
      sssDelta: sss.delta,
      cqsBootstrap: cqsResult.bootstrap,
      nEffective: prop.nEffective,
      confidenceTier: cfe.confidence_tier,
    },
    explanationSnapshot: {},
  };
}
