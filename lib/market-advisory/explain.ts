import { marketLabelFromCatalog } from "./market-catalog";
import { catalogEntryForCode } from "./canonical-probability-adapter";
import type { MsamCandidate, ScoredMsamCandidate } from "./types";

export function buildExplanation(c: MsamCandidate | ScoredMsamCandidate): string {
  const parts: string[] = [];
  const diag = c.diagnosticSnapshot;

  if (c.dimensions.ecs >= 70) {
    parts.push(
      `Evidence coverage adequate (ESS ${Math.round(c.sourceCoverage.effectiveSampleSize)}, tier ${String(diag.confidenceTier ?? "unknown")}).`
    );
  } else if (c.dimensions.ecs < 50) {
    parts.push("Limited historical evidence for this market family on this fixture.");
  }

  if (c.dimensions.sss >= 70) {
    parts.push("Goal distribution stable under parameter perturbation.");
  } else if (diag.sssDelta != null && Number(diag.sssDelta) >= 0.12) {
    parts.push(
      `Probability sensitive to input uncertainty (spread ${(Number(diag.sssDelta) * 100).toFixed(1)} pp).`
    );
  }

  if (diag.cqsBootstrap) {
    parts.push("Calibration uses provisional bootstrap from settled batch history.");
  } else if (c.dimensions.cqs >= 65) {
    parts.push("Acceptable recent calibration for this probability band.");
  }

  parts.push("Not a guarantee. Probability reflects model evidence available before kickoff.");

  return parts.join(" ");
}

export function ineligibleNote(code: string): string {
  switch (code) {
    case "INSUFFICIENT_HT_HISTORY":
      return "First-half markets not advised: half-time result coverage is below the required threshold.";
    case "CORNERS_MODEL_UNAVAILABLE":
      return "Corners not advised: sufficient validated corner history is unavailable.";
    case "LOW_CALIBRATION_SAMPLE":
      return "Calibration sample too small for this market context.";
    case "PROBABILITY_INTEGRITY_FAILURE":
      return "Market suppressed: canonical probability coherence check failed.";
    case "HIGH_PARAMETER_SENSITIVITY":
      return "Market flagged: probability too sensitive to parameter uncertainty.";
    default:
      return `Market not advised: ${code.replace(/_/g, " ").toLowerCase()}.`;
  }
}

export function formatMarketDisplay(c: MsamCandidate): {
  marketLabel: string;
  prediction: string;
} {
  const entry = catalogEntryForCode(c.marketCode);
  return {
    marketLabel: entry ? marketLabelFromCatalog(entry) : c.marketFamily,
    prediction: c.selectionLabel,
  };
}
