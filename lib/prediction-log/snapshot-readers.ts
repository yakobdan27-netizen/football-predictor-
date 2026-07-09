import { LOG_MARKET_MAP, pickOptionsForMarket } from "./markets-config";
import type {
  FrozenBetterAlternative,
  FrozenMarketEntry,
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
