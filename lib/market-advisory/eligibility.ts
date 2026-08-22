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

const HALF_FAMILIES = new Set([
  "HALF_GOALS",
  "HSH",
  "HT_RESULT",
  "DIEH",
  "WIN_ONE_HALF",
]);

const HT_COVERAGE_MIN = 30;
const CORNERS_COVERAGE_MIN = 25;
const HT_MODEL_MIN_MATCHES = 6;
const CORNERS_MODEL_MIN_MATCHES = 5;

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

function halfModelReady(cfe: CanonicalFixtureEstimate, propAvailable: boolean): boolean {
  if (!propAvailable || !cfe.diagnostics.halfSumOk) return false;
  const htDiag = cfe.coverageDiagnostics?.ht;
  const homeN =
    (htDiag?.home.systemWith ?? 0) +
    (htDiag?.home.apiWith ?? 0) +
    (cfe.provenance.ess > 0 ? Math.min(cfe.provenance.ess, 20) : 0);
  const awayN =
    (htDiag?.away.systemWith ?? 0) +
    (htDiag?.away.apiWith ?? 0) +
    (cfe.provenance.ess > 0 ? Math.min(cfe.provenance.ess, 20) : 0);
  const minSide = Math.min(homeN, awayN);
  return minSide >= HT_MODEL_MIN_MATCHES;
}

function cornersModelReady(cfe: CanonicalFixtureEstimate, propAvailable: boolean): boolean {
  if (!propAvailable) return false;
  const cornersDiag = cfe.coverageDiagnostics?.corners;
  const homeN =
    (cornersDiag?.home.systemWith ?? 0) + (cornersDiag?.home.apiWith ?? 0);
  const awayN =
    (cornersDiag?.away.systemWith ?? 0) + (cornersDiag?.away.apiWith ?? 0);
  if (Math.min(homeN, awayN) >= CORNERS_MODEL_MIN_MATCHES) return true;
  const lamOk =
    cfe.lambdas.home_corners > 0.2 &&
    cfe.lambdas.away_corners > 0.2 &&
    Number.isFinite(cfe.lambdas.home_corners) &&
    Number.isFinite(cfe.lambdas.away_corners);
  return lamOk && cfe.provenance.ess >= CORNERS_MODEL_MIN_MATCHES;
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

  const htPct = cfe.coverage.ht_pct;
  const cornersPct = cfe.coverage.corners_pct;
  const htCoverageOk = htPct != null && htPct >= HT_COVERAGE_MIN;
  const cornersCoverageOk =
    cornersPct != null && cornersPct >= CORNERS_COVERAGE_MIN;

  if (
    HALF_FAMILIES.has(prop.marketFamily) &&
    !htCoverageOk &&
    !halfModelReady(cfe, prop.rawProbability > 0)
  ) {
    reasons.push("INSUFFICIENT_HT_HISTORY");
  }
  if (
    (prop.marketFamily === "CORNERS" || prop.marketFamily === "SOT") &&
    !cornersCoverageOk &&
    !cornersModelReady(cfe, prop.rawProbability > 0)
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
      htCoveragePct: htPct,
      cornersCoveragePct: cornersPct,
      coverageDiagnostics: cfe.coverageDiagnostics,
    },
    explanationSnapshot: {},
  };
}
