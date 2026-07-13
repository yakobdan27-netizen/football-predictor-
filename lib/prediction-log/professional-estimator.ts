import { impliedProbability, isValidOdds } from "./odds-bands";

/**
 * Professional football estimation layer.
 *
 * This module is purely additive: it turns the engine's existing model
 * probabilities into the price-aware metrics a professional bettor actually
 * uses — value edge, expected value (EV), Kelly stake fraction, and model
 * consensus. It never changes how probabilities are computed; it only reads
 * them and expresses them the way a disciplined estimator would.
 */

export const PRO_CONFIG = {
  /**
   * Approximate bookmaker margin baked into a single decimal price. We only
   * ever see one side of the market, so we can't fully strip the overround;
   * this de-margins the implied price by a typical per-selection share to get
   * a fairer comparison probability. Conservative on purpose.
   */
  marketMargin: 0.05,
  /** Edge (model% − fair implied%) at/above which a price is prime value. */
  strongEdgePct: 8,
  /** Edge at/above which a price carries a genuine positive edge. */
  positiveEdgePct: 3,
  /** Kelly fraction is displayed as a conservative fraction of full Kelly. */
  kellyFraction: 0.25,
  /** Hard cap on the suggested Kelly stake fraction (as a share of bankroll). */
  kellyStakeCap: 0.05,
  /** Estimator spread (max−min, in pct points) mapped to zero agreement. */
  agreementSpreadMax: 40,
  /** Professional rating weights (sum ≈ 1). */
  ratingWeights: { probability: 0.6, edge: 0.3, agreement: 0.1 },
  /** Points of edge mapped onto the 0–100 rating scale. */
  edgeRatingScale: 2.5,
} as const;

export type ValueTier = "strong" | "positive" | "fair" | "negative";
export type AgreementLabel = "aligned" | "mixed" | "divergent";

export interface EdgeMetrics {
  valid: boolean;
  /** Raw implied probability from the price (includes margin), 0–100. */
  impliedPct: number;
  /** De-margined "fair" implied probability, 0–100. */
  fairImpliedPct: number;
  /** Model probability minus fair implied probability, in pct points. */
  edgePct: number;
  /** Expected value per 1 unit staked (model probability × odds − 1). */
  evPerUnit: number;
  /** Conservative Kelly stake fraction of bankroll (0–kellyStakeCap). */
  kellyFraction: number;
  valueTier: ValueTier;
}

export interface AgreementResult {
  agreement: number; // 0–1
  spreadPct: number; // max − min of the estimators
  label: AgreementLabel;
  sources: number; // how many independent estimators were available
}

export interface ProfessionalRead {
  ratingPct: number; // 0–100 blended probability + value + consensus
  edge: EdgeMetrics;
  agreement: AgreementResult;
  verdict: string;
}

export interface ProfessionalLegInput {
  matchLabel: string;
  modelPct: number;
  odds: number | null | undefined;
}

export interface ProfessionalSlipSummary {
  legs: number;
  valueLegs: number;
  avgEdgePct: number | null;
  comboModelProbPct: number | null;
  comboOdds: number | null;
  comboEvPerUnit: number | null;
  weakestValueLeg: string | null;
  headline: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function tierFromEdge(edgePct: number): ValueTier {
  if (edgePct >= PRO_CONFIG.strongEdgePct) return "strong";
  if (edgePct >= PRO_CONFIG.positiveEdgePct) return "positive";
  if (edgePct >= 0) return "fair";
  return "negative";
}

/**
 * Convert a model probability (0–100) and a decimal price into the core
 * price-aware metrics. Returns an invalid, neutral result when odds are
 * missing so callers can fall back to probability-only behaviour.
 */
export function computeEdgeMetrics(
  modelPct: number,
  odds: number | null | undefined
): EdgeMetrics {
  if (!isValidOdds(odds)) {
    return {
      valid: false,
      impliedPct: 0,
      fairImpliedPct: 0,
      edgePct: 0,
      evPerUnit: 0,
      kellyFraction: 0,
      valueTier: "fair",
    };
  }

  const modelP = clamp(modelPct / 100, 0, 1);
  const implied = impliedProbability(odds);
  const fairImplied = clamp(implied / (1 + PRO_CONFIG.marketMargin), 0, 1);
  const edgePct = round1((modelP - fairImplied) * 100);
  const evPerUnit = round1((modelP * odds - 1) * 100) / 100;

  // Full Kelly: (b·p − q) / b, with b = odds − 1. Scale to a conservative
  // fraction and cap so the display never suggests reckless staking.
  const b = odds - 1;
  const q = 1 - modelP;
  const fullKelly = b > 0 ? (b * modelP - q) / b : 0;
  const kellyFraction = clamp(
    fullKelly * PRO_CONFIG.kellyFraction,
    0,
    PRO_CONFIG.kellyStakeCap
  );

  return {
    valid: true,
    impliedPct: Math.round(implied * 100),
    fairImpliedPct: Math.round(fairImplied * 100),
    edgePct,
    evPerUnit,
    kellyFraction: Math.round(kellyFraction * 1000) / 1000,
    valueTier: tierFromEdge(edgePct),
  };
}

/**
 * Consensus across the independent estimators (Dixon-Coles, ML, Bayesian and
 * the heuristic blend). A professional trusts a pick more when several
 * independent methods land in the same place, and is cautious when they
 * diverge. Inputs are percentages (0–100); undefined inputs are ignored.
 */
export function computeModelAgreement(inputs: {
  pDc?: number | null;
  pMl?: number | null;
  pBayes?: number | null;
  pCustom?: number | null;
}): AgreementResult {
  const values = [inputs.pDc, inputs.pMl, inputs.pBayes, inputs.pCustom].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );

  if (values.length < 2) {
    return { agreement: 0.5, spreadPct: 0, label: "mixed", sources: values.length };
  }

  const spread = Math.max(...values) - Math.min(...values);
  const agreement = clamp(1 - spread / PRO_CONFIG.agreementSpreadMax, 0, 1);
  const label: AgreementLabel =
    agreement >= 0.66 ? "aligned" : agreement >= 0.4 ? "mixed" : "divergent";

  return { agreement, spreadPct: Math.round(spread), label, sources: values.length };
}

/**
 * Blend probability, value edge and consensus into a single 0–100 rating.
 * Probability stays the dominant term (professional discipline: never chase
 * value on a coin-flip), edge rewards genuine mispricings, and consensus is a
 * small confidence multiplier.
 */
export function computeProfessionalRating(params: {
  pFinalPct: number;
  edgePct: number;
  agreement: number;
}): number {
  const w = PRO_CONFIG.ratingWeights;
  const edgeComponent = clamp(50 + params.edgePct * PRO_CONFIG.edgeRatingScale, 0, 100);
  const agreementComponent = clamp(params.agreement * 100, 0, 100);
  const rating =
    w.probability * clamp(params.pFinalPct, 0, 100) +
    w.edge * edgeComponent +
    w.agreement * agreementComponent;
  return Math.round(clamp(rating, 0, 100));
}

export function professionalVerdict(
  valueTier: ValueTier,
  agreementLabel: AgreementLabel,
  hasPrice: boolean
): string {
  if (!hasPrice) {
    return "Enter odds to grade the price — probability looks usable.";
  }
  if (valueTier === "strong") {
    return agreementLabel === "divergent"
      ? "Big edge, but the models disagree — size down."
      : "Prime value — model beats the price with room to spare.";
  }
  if (valueTier === "positive") {
    return agreementLabel === "aligned"
      ? "Solid value with the models aligned — a professional's pick."
      : "Genuine edge, though consensus is mixed — a measured stake.";
  }
  if (valueTier === "fair") {
    return "Fairly priced — the market agrees with the model. Thin margin.";
  }
  return "No edge at this price — model likes the outcome, the odds don't pay.";
}

/**
 * Full professional read for one leg. `pFinalPct` should be the probability the
 * user will actually see (post batch-risk brake), so EV and edge match the
 * displayed confidence.
 */
export function buildProfessionalRead(params: {
  pFinalPct: number;
  odds: number | null | undefined;
  estimators: { pDc?: number | null; pMl?: number | null; pBayes?: number | null; pCustom?: number | null };
}): ProfessionalRead {
  const edge = computeEdgeMetrics(params.pFinalPct, params.odds);
  const agreement = computeModelAgreement(params.estimators);
  const ratingPct = computeProfessionalRating({
    pFinalPct: params.pFinalPct,
    edgePct: edge.valid ? edge.edgePct : 0,
    agreement: agreement.agreement,
  });
  const verdict = professionalVerdict(edge.valueTier, agreement.label, edge.valid);
  return { ratingPct, edge, agreement, verdict };
}

/**
 * A price-aware read on the whole accumulator: combined model probability,
 * combined odds, and the accumulator's expected value — plus how many legs
 * carry a genuine edge and which is the weakest by value.
 */
export function summarizeSlipValue(legs: ProfessionalLegInput[]): ProfessionalSlipSummary {
  const priced = legs.filter((l) => isValidOdds(l.odds));

  if (priced.length === 0) {
    return {
      legs: legs.length,
      valueLegs: 0,
      avgEdgePct: null,
      comboModelProbPct: null,
      comboOdds: null,
      comboEvPerUnit: null,
      weakestValueLeg: null,
      headline:
        legs.length === 0
          ? "No legs to price yet."
          : "Add odds to grade this slip's value.",
    };
  }

  let comboProb = 1;
  let comboOdds = 1;
  let edgeSum = 0;
  let valueLegs = 0;
  let weakest: { label: string; edge: number } | null = null;

  for (const leg of priced) {
    const odds = leg.odds as number;
    const edge = computeEdgeMetrics(leg.modelPct, odds);
    comboProb *= clamp(leg.modelPct / 100, 0, 1);
    comboOdds *= odds;
    edgeSum += edge.edgePct;
    if (edge.valueTier === "strong" || edge.valueTier === "positive") valueLegs += 1;
    if (!weakest || edge.edgePct < weakest.edge) {
      weakest = { label: leg.matchLabel, edge: edge.edgePct };
    }
  }

  const comboModelProbPct = Math.round(comboProb * 100);
  const comboOddsRounded = Math.round(comboOdds * 100) / 100;
  const comboEvPerUnit = Math.round((comboProb * comboOdds - 1) * 100) / 100;
  const avgEdgePct = round1(edgeSum / priced.length);

  const headline =
    comboEvPerUnit > 0
      ? `Positive-EV slip: ${valueLegs}/${priced.length} legs carry an edge (avg ${avgEdgePct >= 0 ? "+" : ""}${avgEdgePct} pts).`
      : `Negative-EV slip at these prices — ${valueLegs}/${priced.length} legs carry an edge.`;

  return {
    legs: legs.length,
    valueLegs,
    avgEdgePct,
    comboModelProbPct,
    comboOdds: comboOddsRounded,
    comboEvPerUnit,
    weakestValueLeg: weakest?.label ?? null,
    headline,
  };
}
