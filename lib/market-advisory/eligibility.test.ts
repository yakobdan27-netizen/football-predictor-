/**
 * Run: npx tsx lib/market-advisory/eligibility.test.ts
 */
import assert from "node:assert/strict";
import { buildCanonicalProbabilitySnapshot } from "./canonical-probability-adapter";
import { scoreCandidate } from "./eligibility";
import { minimalCfe } from "./test-fixtures";

const cfe = minimalCfe();
const snapshot = buildCanonicalProbabilitySnapshot({ cfe, calibrator: null });

const htProp = snapshot.propositions.find((p) => p.marketFamily === "HT_RESULT");
assert.ok(htProp, "HT_RESULT proposition expected");

const htScored = scoreCandidate({
  prop: htProp!,
  cfe,
  snapshot,
  calibrator: null,
  analysis: null,
  cqsBootstrap: true,
  fixtureIdentityOk: true,
  fixtureCancelled: false,
});

assert.ok(
  htScored.eligible || !htScored.ineligibilityReasonCodes.includes("INSUFFICIENT_HT_HISTORY"),
  "HT market should be eligible or not blocked solely on null coverage"
);

const cornersProp = snapshot.propositions.find((p) => p.marketFamily === "CORNERS");
if (cornersProp) {
  const cornersScored = scoreCandidate({
    prop: cornersProp,
    cfe,
    snapshot,
    calibrator: null,
    analysis: null,
    cqsBootstrap: true,
    fixtureIdentityOk: true,
    fixtureCancelled: false,
  });
  assert.ok(
    cornersScored.eligible ||
      !cornersScored.ineligibilityReasonCodes.includes("CORNERS_MODEL_UNAVAILABLE"),
    "corners should be eligible when coverage or model ready"
  );
}

const sparseCfe = {
  ...cfe,
  coverage: { ht_pct: null, corners_pct: null },
  coverageDiagnostics: undefined,
  diagnostics: { ...cfe.diagnostics, halfSumOk: false },
  provenance: { ...cfe.provenance, ess: 2 },
};

const sparseHt = scoreCandidate({
  prop: htProp!,
  cfe: sparseCfe,
  snapshot,
  calibrator: null,
  analysis: null,
  cqsBootstrap: true,
  fixtureIdentityOk: true,
  fixtureCancelled: false,
});

assert.ok(
  sparseHt.ineligibilityReasonCodes.includes("INSUFFICIENT_HT_HISTORY"),
  "sparse HT data should remain ineligible"
);

console.log("eligibility tests passed");
