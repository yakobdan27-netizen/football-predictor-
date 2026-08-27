/**
 * Thin wrapper — slip builder and UI must obtain p_raw via canonicalProbability.
 * Never recompute market probs locally on the page.
 */
import { canonicalProbability } from "@/lib/prediction-log/canonical-probability";
import type { CfeLegEstimateSlice } from "@/lib/prediction-log/cfe-leg-probability";
import type { MarketFamilyId } from "./types";

export type CanonicalLegScore = {
  pRaw: number;
  nEffective: number;
  coherenceOk: boolean;
  available: boolean;
  reason?: string;
  meta?: Record<string, unknown>;
};

export function scoreLegFromCanonical(input: {
  estimate: CfeLegEstimateSlice;
  family: MarketFamilyId;
  selectionKey: string;
  line?: number | null;
  comboId?: string | null;
  fixtureKey?: string;
}): CanonicalLegScore {
  try {
    const result = canonicalProbability({
      market: "cfe_leg",
      estimate: input.estimate,
      family: input.family,
      selectionKey: input.selectionKey,
      line: input.line,
      comboId: input.comboId,
      fixtureKey: input.fixtureKey,
    });
    const coherenceOk =
      typeof result.meta?.coherenceOk === "boolean"
        ? result.meta.coherenceOk
        : true;
    return {
      pRaw: result.prob,
      nEffective: result.sampleSize ?? 0,
      coherenceOk,
      available: true,
      meta: result.meta,
    };
  } catch (e) {
    return {
      pRaw: 0,
      nEffective: input.estimate.provenance.ess || 0,
      coherenceOk: false,
      available: false,
      reason: e instanceof Error ? e.message : "unavailable",
    };
  }
}
