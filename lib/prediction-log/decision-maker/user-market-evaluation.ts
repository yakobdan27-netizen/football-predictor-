/**
 * 5th Decision Maker slot: evaluate the user's filled market (Prediction Log / Telegram).
 * Never blocks; always returns a status cell.
 */
import { LOG_MARKET_MAP, pickOptionsForMarket } from "../markets-config";
import { derivePickComment } from "../pick-comment";
import type { FrozenBetterAlternative, LogMarketKey, LogMatch } from "../types";
import { clampConfidence } from "./confidence";
import type { ScoredDecisionMarket, UserMarketEvaluation } from "./types";

export const USER_MARKET_EVAL_MAX_COMMENT = 140;

function truncateComment(msg: string, max = USER_MARKET_EVAL_MAX_COMMENT): string {
  const t = msg.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Primary user market = highest confidence filled prediction. */
export function selectPrimaryUserMarket(
  match: LogMatch
): { marketKey: LogMarketKey; prediction: string; line?: number; confidence: number } | null {
  let best: {
    marketKey: LogMarketKey;
    prediction: string;
    line?: number;
    confidence: number;
  } | null = null;

  for (const [key, pred] of Object.entries(match.predictions)) {
    if (!pred?.prediction) continue;
    const marketKey = key as LogMarketKey;
    const confidence = clampConfidence(pred.confidence ?? 50);
    if (!best || confidence > best.confidence) {
      best = {
        marketKey,
        prediction: pred.prediction,
        line: pred.line,
        confidence,
      };
    }
  }
  return best;
}

function predictionDisplayLabel(
  marketKey: LogMarketKey,
  prediction: string,
  line: number | undefined,
  homeTeam: string,
  awayTeam: string
): string {
  return (
    pickOptionsForMarket(marketKey, homeTeam, awayTeam, line).find(
      (o) => o.value === prediction
    )?.label ?? prediction
  );
}

/**
 * Build the always-present 5th decision cell.
 */
export function buildUserMarketEvaluation(args: {
  match: LogMatch;
  topThree: ScoredDecisionMarket[];
  /** Optional system % for the same marketKey from registry/recommendation. */
  systemProbabilityPct?: number | null;
}): UserMarketEvaluation {
  const primary = selectPrimaryUserMarket(args.match);
  if (!primary) {
    return {
      status: "none",
      comment: "No user market selected",
    };
  }

  const marketLabel = LOG_MARKET_MAP[primary.marketKey]?.label ?? primary.marketKey;
  const predictionLabel = predictionDisplayLabel(
    primary.marketKey,
    primary.prediction,
    primary.line,
    args.match.homeTeam,
    args.match.awayTeam
  );

  const systemPct =
    args.systemProbabilityPct != null && Number.isFinite(args.systemProbabilityPct)
      ? clampConfidence(args.systemProbabilityPct)
      : primary.confidence;

  // Best alternative among top-3 that isn't the same marketKey
  const altMarket = args.topThree.find((m) => m.marketKey !== primary.marketKey) ?? null;
  const sameInTop = args.topThree.find((m) => m.marketKey === primary.marketKey);

  let betterAlt: FrozenBetterAlternative | null = null;
  if (altMarket && (!sameInTop || altMarket.confidence > systemPct + 8)) {
    betterAlt = {
      marketKey: altMarket.marketKey as LogMarketKey,
      marketLabel: altMarket.label,
      prediction: altMarket.prediction,
      predictionLabel: altMarket.prediction,
      pFinal: altMarket.confidence,
      isOptimal: false,
      deltaPct: Math.max(0, altMarket.confidence - systemPct),
    };
  } else if (sameInTop && Math.abs(sameInTop.confidence - systemPct) < 8) {
    betterAlt = {
      marketKey: primary.marketKey,
      marketLabel,
      prediction: primary.prediction,
      predictionLabel,
      pFinal: systemPct,
      isOptimal: true,
      deltaPct: 0,
    };
  }

  const derived = derivePickComment({
    selectedPFinal: systemPct,
    betterAlt,
  });
  const comment = truncateComment(derived.message);

  return {
    status: "filled",
    marketKey: primary.marketKey,
    marketLabel,
    predictionLabel,
    probabilityPct: systemPct,
    comment,
  };
}

export function formatUserMarketEvalLine(evalRow: UserMarketEvaluation): string {
  if (evalRow.status === "none") return "No user market selected";
  const pct =
    evalRow.probabilityPct != null ? `${Math.round(evalRow.probabilityPct)}%` : "—";
  return `User market: ${evalRow.predictionLabel ?? evalRow.marketLabel} – ${pct}`;
}

export function computeRowConfidenceScore(args: {
  markets: ScoredDecisionMarket[];
  comboPFinal: number | null;
  userEval: UserMarketEvaluation;
}): number {
  const parts: number[] = [];
  for (const m of args.markets) {
    if (m?.confidence != null) parts.push(clampConfidence(m.confidence));
  }
  if (args.comboPFinal != null) parts.push(clampConfidence(args.comboPFinal));
  if (args.userEval.status === "filled" && args.userEval.probabilityPct != null) {
    parts.push(clampConfidence(args.userEval.probabilityPct));
  }
  if (parts.length === 0) return 0;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}
