import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import { resolveCfeLegProbability } from "@/lib/prediction-log/cfe-leg-probability";
import type { BinCalibrator } from "@/lib/predictor/calibration";
import {
  applySlipCalibration,
  estimateCiWidth,
} from "@/lib/slip-builder/slip-calibration";
import { runIntegrityGate } from "./integrity-gate";
import {
  enumerateMsamCatalog,
  marketLabelFromCatalog,
  type CatalogEntry,
} from "./market-catalog";
import { buildSourceCoverage } from "./source-coverage";
import type { CanonicalProposition } from "./types";

export type CanonicalProbabilitySnapshot = {
  integrityPassed: boolean;
  integrityChecks: ReturnType<typeof runIntegrityGate>["checks"];
  suppressedFamilies: Set<string>;
  propositions: CanonicalProposition[];
  sourceCoverage: ReturnType<typeof buildSourceCoverage>;
  modelVersion: string;
};

export function buildCanonicalProbabilitySnapshot(input: {
  cfe: CanonicalFixtureEstimate;
  calibrator: BinCalibrator | null;
}): CanonicalProbabilitySnapshot {
  const { cfe, calibrator } = input;
  const gate = runIntegrityGate(cfe);
  const catalog = enumerateMsamCatalog();
  const propositions: CanonicalProposition[] = [];

  for (const entry of catalog) {
    if (
      gate.suppressedFamilies.has("ALL") ||
      gate.suppressedFamilies.has(entry.marketFamily)
    ) {
      continue;
    }

    const resolved = resolveCfeLegProbability({
      estimate: cfe,
      family: entry.marketFamily,
      selectionKey: entry.selectionKey,
      line: entry.line,
      comboId: entry.comboId,
    });

    if (!resolved.available) continue;

    const slip = applySlipCalibration(
      resolved.prob,
      resolved.nEffective,
      calibrator
    );
    const ciWidth = estimateCiWidth(
      resolved.prob,
      resolved.nEffective,
      calibrator
    );

    propositions.push({
      marketCode: entry.marketCode,
      marketFamily: entry.marketFamily,
      conflictGroup: entry.conflictGroup,
      selectionKey: entry.selectionKey,
      selectionLabel: entry.selectionLabel,
      line: entry.line,
      comboId: entry.comboId,
      rawProbability: resolved.prob,
      calibratedProbability: slip.pCalibrated,
      probabilityLower: Math.max(0, slip.pCalibrated - ciWidth / 2),
      probabilityUpper: Math.min(1, slip.pCalibrated + ciWidth / 2),
      calibrated: slip.calibrated,
      coherenceOk: resolved.coherenceOk && gate.passed,
      nEffective: resolved.nEffective,
      marketDefinition: {
        familyLabel: marketLabelFromCatalog(entry),
        selectionKey: entry.selectionKey,
        line: entry.line ?? null,
        comboId: entry.comboId ?? null,
      },
    });
  }

  return {
    integrityPassed: gate.passed,
    integrityChecks: gate.checks,
    suppressedFamilies: gate.suppressedFamilies,
    propositions,
    sourceCoverage: buildSourceCoverage(cfe),
    modelVersion: cfe.model_params_version,
  };
}

export function findProposition(
  snapshot: CanonicalProbabilitySnapshot,
  marketCode: string
): CanonicalProposition | undefined {
  return snapshot.propositions.find((p) => p.marketCode === marketCode);
}

export function catalogEntryForCode(
  marketCode: string
): CatalogEntry | undefined {
  return enumerateMsamCatalog().find((e) => e.marketCode === marketCode);
}
