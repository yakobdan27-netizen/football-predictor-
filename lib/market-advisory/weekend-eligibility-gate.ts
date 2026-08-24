/**
 * Lightweight MSAM eligibility checks for Weekend Picks candidate filtering.
 * Mirrors core rules from eligibility.ts scoreCandidate() without full MSAM scoring.
 */
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { MarketFamilyId } from "@/lib/slip-builder/types";
import type { IneligibilityReasonCode } from "./types";

const HALF_FAMILIES = new Set<MarketFamilyId>([
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

function halfModelReady(
  cfe: CanonicalFixtureEstimate,
  propAvailable: boolean
): boolean {
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
  return Math.min(homeN, awayN) >= HT_MODEL_MIN_MATCHES;
}

function cornersModelReady(
  cfe: CanonicalFixtureEstimate,
  propAvailable: boolean
): boolean {
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

export type WeekendEligibilityInput = {
  family: MarketFamilyId;
  pRaw: number;
  nEffective: number;
  coherenceOk: boolean;
  cfe: CanonicalFixtureEstimate;
  /** When false, skip integrity check (no full snapshot). Default true. */
  integrityPassed?: boolean;
};

export function weekendMsamIneligibilityReasons(
  input: WeekendEligibilityInput
): IneligibilityReasonCode[] {
  const reasons: IneligibilityReasonCode[] = [];
  const { family, pRaw, nEffective, coherenceOk, cfe } = input;
  const integrityPassed = input.integrityPassed !== false;

  if (!integrityPassed || !coherenceOk) {
    reasons.push("PROBABILITY_INTEGRITY_FAILURE");
  }
  if (nEffective < 5) {
    reasons.push("INSUFFICIENT_SAMPLE");
  }

  const htPct = cfe.coverage.ht_pct;
  const cornersPct = cfe.coverage.corners_pct;
  const htCoverageOk = htPct != null && htPct >= HT_COVERAGE_MIN;
  const cornersCoverageOk =
    cornersPct != null && cornersPct >= CORNERS_COVERAGE_MIN;

  if (
    HALF_FAMILIES.has(family) &&
    !htCoverageOk &&
    !halfModelReady(cfe, pRaw > 0)
  ) {
    reasons.push("INSUFFICIENT_HT_HISTORY");
  }
  if (
    (family === "CORNERS" || family === "SOT") &&
    !cornersCoverageOk &&
    !cornersModelReady(cfe, pRaw > 0)
  ) {
    reasons.push("CORNERS_MODEL_UNAVAILABLE");
  }
  if (family === "DIEH" && cfe.markets.dieh.status !== "ok") {
    reasons.push("SPECIALIST_MODEL_UNAVAILABLE");
  }

  return reasons;
}

export function weekendMsamEligible(input: WeekendEligibilityInput): boolean {
  return weekendMsamIneligibilityReasons(input).length === 0;
}
