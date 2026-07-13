import assert from "node:assert/strict";
import {
  buildProfessionalRead,
  computeEdgeMetrics,
  computeModelAgreement,
  computeProfessionalRating,
  summarizeSlipValue,
} from "./professional-estimator";

// --- computeEdgeMetrics ---

// Missing / invalid odds → neutral, invalid read (falls back to prob-only)
const noOdds = computeEdgeMetrics(70, undefined);
assert.equal(noOdds.valid, false);
assert.equal(noOdds.edgePct, 0);
assert.equal(noOdds.evPerUnit, 0);

// Model 65% at even money (2.0): fair implied ≈ 47.6% → strong positive edge
const strong = computeEdgeMetrics(65, 2.0);
assert.equal(strong.valid, true);
assert.ok(strong.edgePct > 8, `expected strong edge, got ${strong.edgePct}`);
assert.equal(strong.valueTier, "strong");
// EV = 0.65 * 2.0 - 1 = 0.30
assert.ok(Math.abs(strong.evPerUnit - 0.3) < 0.001, `EV was ${strong.evPerUnit}`);
assert.ok(strong.kellyFraction > 0 && strong.kellyFraction <= 0.05);

// Model below the price → negative edge / EV
const negative = computeEdgeMetrics(40, 2.0);
assert.equal(negative.valueTier, "negative");
assert.ok(negative.edgePct < 0);
assert.ok(negative.evPerUnit < 0);
assert.equal(negative.kellyFraction, 0);

// Fairly priced: model ≈ fair implied
const fair = computeEdgeMetrics(49, 2.0);
assert.equal(fair.valueTier, "fair");

// --- computeModelAgreement ---

const aligned = computeModelAgreement({ pDc: 70, pMl: 72, pBayes: 68, pCustom: 71 });
assert.equal(aligned.label, "aligned");
assert.ok(aligned.agreement >= 0.66);
assert.equal(aligned.sources, 4);

const divergent = computeModelAgreement({ pDc: 40, pMl: 80, pCustom: 55 });
assert.equal(divergent.label, "divergent");
assert.ok(divergent.agreement < 0.4);

// Fewer than two estimators → neutral mixed
const sparse = computeModelAgreement({ pDc: 60 });
assert.equal(sparse.label, "mixed");
assert.equal(sparse.sources, 1);

// --- computeProfessionalRating ---

// More edge (all else equal) never lowers the rating
const baseRating = computeProfessionalRating({ pFinalPct: 60, edgePct: 0, agreement: 0.6 });
const valueRating = computeProfessionalRating({ pFinalPct: 60, edgePct: 10, agreement: 0.6 });
assert.ok(valueRating >= baseRating);
// Probability stays dominant: a 75% coin-flip-beater outranks a 55% value play
const highProb = computeProfessionalRating({ pFinalPct: 75, edgePct: 0, agreement: 0.6 });
const lowProbValue = computeProfessionalRating({ pFinalPct: 55, edgePct: 6, agreement: 0.6 });
assert.ok(highProb > lowProbValue);

// --- buildProfessionalRead ---

const read = buildProfessionalRead({
  pFinalPct: 66,
  odds: 2.0,
  estimators: { pDc: 64, pMl: 68, pBayes: 66, pCustom: 65 },
});
assert.equal(read.edge.valid, true);
assert.equal(read.agreement.label, "aligned");
assert.ok(read.ratingPct > 0 && read.ratingPct <= 100);
assert.ok(read.verdict.length > 0);

const readNoPrice = buildProfessionalRead({
  pFinalPct: 66,
  odds: null,
  estimators: { pDc: 64, pMl: 68 },
});
assert.equal(readNoPrice.edge.valid, false);
assert.match(readNoPrice.verdict, /Enter odds/);

// --- summarizeSlipValue ---

const emptySlip = summarizeSlipValue([]);
assert.equal(emptySlip.comboEvPerUnit, null);
assert.equal(emptySlip.valueLegs, 0);

const unpriced = summarizeSlipValue([{ matchLabel: "A vs B", modelPct: 60, odds: undefined }]);
assert.equal(unpriced.comboEvPerUnit, null);

const slip = summarizeSlipValue([
  { matchLabel: "A vs B", modelPct: 65, odds: 2.0 },
  { matchLabel: "C vs D", modelPct: 60, odds: 1.8 },
]);
assert.equal(slip.legs, 2);
assert.ok(slip.valueLegs >= 1);
assert.ok(slip.comboOdds != null && Math.abs(slip.comboOdds - 3.6) < 0.001);
// combined model prob = 0.65 * 0.60 = 0.39 → 39%
assert.equal(slip.comboModelProbPct, 39);
// combo EV = 0.39 * 3.6 - 1 = 0.404
assert.ok(slip.comboEvPerUnit != null && Math.abs(slip.comboEvPerUnit - 0.4) < 0.02);
assert.ok(slip.weakestValueLeg != null);
assert.ok(slip.headline.length > 0);

console.log("professional-estimator tests passed");
