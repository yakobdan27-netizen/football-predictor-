import { LOG_MARKET_MAP, pickOptionsForMarket } from "./markets-config";
import type {
  FrozenBetterAlternative,
  FrozenMarketEntry,
  FrozenProfessionalRead,
  FrozenProfessionalSlip,
  FrozenSystemPick,
  LogMarketKey,
  PredictionBatch,
  RecommendedBatch,
  RecommendedBatchMathSnapshot,
  RecommendedMatch,
} from "./types";

export interface MatchSummaryRow {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  systemPick: FrozenSystemPick | null;
  selectedMarketLabel: string;
  selectedPredictionLabel: string;
  selectedPFinal: number | null;
  betterAlternative: FrozenBetterAlternative | null;
  pickComment: { label: "good" | "risky" | "avoid"; message: string } | null;
  confidenceSource: string | null;
  hasExtendedSnapshot: boolean;
}

function pickLabel(
  marketKey: LogMarketKey,
  prediction: string,
  line: number | undefined,
  homeTeam: string,
  awayTeam: string
): string {
  const opts = pickOptionsForMarket(marketKey, homeTeam, awayTeam, line);
  const found = opts.find((o) => o.value === prediction);
  if (found) return found.label;
  if (line != null) return `${prediction} ${line}`;
  return prediction;
}

export function getMathSnapshot(
  batch: PredictionBatch
): RecommendedBatchMathSnapshot | null {
  return batch.recommended?.mathSnapshot ?? null;
}

export function hasExtendedSnapshot(batch: PredictionBatch): boolean {
  const math = getMathSnapshot(batch);
  return Boolean(math?.marketComparisonByMatch && math?.systemPickByMatch);
}

export function getBatchDisplayId(batch: PredictionBatch): string {
  return batch.recommendationId ?? batch.id;
}

export function getTierAccentColor(tier: PredictionBatch["recommendationTier"]): string {
  if (tier === "safe") return "var(--accent)";
  if (tier === "aggressive") return "var(--warn)";
  return "#5aa0ff";
}

/** Human-readable tier for summary cards (Extreme Safe / Balanced / Aggressive). */
export function tierDisplayLabel(tier: PredictionBatch["recommendationTier"]): string {
  if (tier === "safe") return "Extreme Safe";
  if (tier === "aggressive") return "Aggressive";
  if (tier === "balanced") return "Balanced";
  return "Balanced";
}

export function formatSystemPickLine(pick: FrozenSystemPick | null): string {
  if (!pick) return "—";
  return pick.label;
}

/** Resolve a batch by `recommendationId` or internal `id` (for `?batch=` deep links). */
export function resolveBatchByQuery(
  batches: PredictionBatch[],
  query: string | null | undefined
): PredictionBatch | null {
  if (!query) return null;
  const q = query.trim();
  if (!q) return null;
  return (
    batches.find((b) => b.recommendationId === q || b.id === q) ?? null
  );
}

export function buildMatchSummaryRows(
  batch: PredictionBatch,
  recommended: RecommendedBatch
): MatchSummaryRow[] {
  const math = recommended.mathSnapshot;
  const hasExtended = Boolean(math?.marketComparisonByMatch);

  return recommended.matches.map((rm) => {
    const acceptedPick = Object.entries(rm.predictions).find(
      ([, p]) => p && p.action !== "remove"
    ) as [LogMarketKey, (typeof rm.predictions)[LogMarketKey]] | undefined;

    const marketKey = acceptedPick?.[0];
    const pick = acceptedPick?.[1];
    const pFinal =
      (marketKey && math?.pFinalByMatch[rm.id]) ?? pick?.pFinal ?? null;

    const systemPick = math?.systemPickByMatch?.[rm.id] ?? null;
    const betterAlternative = math?.betterAlternativeByMatch?.[rm.id] ?? null;
    const pickComment = math?.pickCommentByMatch?.[rm.id] ?? null;
    const confidenceSource = pick?.confidenceBreakdown ?? null;

    return {
      matchId: rm.id,
      homeTeam: rm.homeTeam,
      awayTeam: rm.awayTeam,
      systemPick,
      selectedMarketLabel: marketKey
        ? (LOG_MARKET_MAP[marketKey]?.label ?? marketKey)
        : "—",
      selectedPredictionLabel:
        marketKey && pick
          ? pickLabel(marketKey, pick.prediction, pick.line, rm.homeTeam, rm.awayTeam)
          : "—",
      selectedPFinal: pFinal,
      betterAlternative,
      pickComment,
      confidenceSource,
      hasExtendedSnapshot: hasExtended,
    };
  });
}

export function getMarketComparisonForMatch(
  batch: PredictionBatch,
  matchId: string
): FrozenMarketEntry[] {
  return batch.recommended?.mathSnapshot?.marketComparisonByMatch?.[matchId] ?? [];
}

export function getProfessionalForMatch(
  batch: PredictionBatch,
  matchId: string
): FrozenProfessionalRead | null {
  return batch.recommended?.mathSnapshot?.professionalByMatch?.[matchId] ?? null;
}

export function getProfessionalSummary(
  batch: PredictionBatch
): FrozenProfessionalSlip | null {
  return batch.recommended?.mathSnapshot?.professionalSummary ?? null;
}

export function valueTierColor(tier: FrozenProfessionalRead["valueTier"]): string {
  if (tier === "strong") return "var(--accent)";
  if (tier === "positive") return "#4fb477";
  if (tier === "fair") return "var(--muted)";
  return "var(--warn)";
}

export function valueTierLabel(tier: FrozenProfessionalRead["valueTier"]): string {
  if (tier === "strong") return "Prime value";
  if (tier === "positive") return "Value";
  if (tier === "fair") return "Fair price";
  return "No edge";
}

export function formatBetterAlternativeLine(alt: FrozenBetterAlternative | null): {
  text: string;
  showArrow: boolean;
  isOptimal: boolean;
} {
  if (!alt) {
    return { text: "—", showArrow: false, isOptimal: false };
  }
  if (alt.isOptimal) {
    return { text: "Selected market is optimal ✓", showArrow: false, isOptimal: true };
  }
  return {
    text: `${alt.marketLabel} — ${alt.predictionLabel} — ${alt.pFinal}%`,
    showArrow: true,
    isOptimal: false,
  };
}

export function getSelectedPickForMatch(rm: RecommendedMatch): {
  marketKey: LogMarketKey;
  pick: NonNullable<RecommendedMatch["predictions"][LogMarketKey]>;
} | null {
  const entry = Object.entries(rm.predictions).find(
    ([, p]) => p && p.action !== "remove"
  ) as [LogMarketKey, NonNullable<RecommendedMatch["predictions"][LogMarketKey]>] | undefined;
  if (!entry) return null;
  return { marketKey: entry[0], pick: entry[1] };
}

/** Display-only High / Medium / Low for Recommendation page badges. */
export type RecoDisplayConfidence = "high" | "medium" | "low";

export function mapPFinalToDisplayConfidence(
  pFinal: number | null | undefined
): RecoDisplayConfidence {
  if (pFinal == null || !Number.isFinite(pFinal)) return "low";
  if (pFinal >= 60) return "high";
  if (pFinal >= 45) return "medium";
  return "low";
}

export function mapConfidenceBandToDisplay(
  band: "strong" | "solid" | "coin_flip" | "avoid" | undefined,
  pFinal?: number | null
): RecoDisplayConfidence {
  if (band === "strong") return "high";
  if (band === "solid") return "medium";
  if (band === "coin_flip" || band === "avoid") return "low";
  return mapPFinalToDisplayConfidence(pFinal);
}

export function mapBatchRiskToDisplayConfidence(
  band: "safe" | "caution" | "high" | undefined,
  averagePFinal?: number | null
): RecoDisplayConfidence {
  if (averagePFinal != null && Number.isFinite(averagePFinal)) {
    return mapPFinalToDisplayConfidence(averagePFinal);
  }
  if (band === "safe") return "high";
  if (band === "caution") return "medium";
  if (band === "high") return "low";
  return "low";
}

export function displayConfidenceLabel(c: RecoDisplayConfidence): string {
  if (c === "high") return "High";
  if (c === "medium") return "Medium";
  return "Low";
}
