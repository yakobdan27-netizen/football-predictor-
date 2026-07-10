import {
  BETTER_ALTERNATIVE_THRESHOLD_PCT,
} from "./recommendation-config";
import type { FrozenBetterAlternative } from "./types";

export type PickCommentLabel = "good" | "risky" | "avoid";

export interface FrozenPickComment {
  label: PickCommentLabel;
  message: string;
}

const AVOID_P_FINAL = 50;
const STRONG_DOMINANCE_MULT = 2;

/**
 * Comment on the user's selected market vs engine best alternative.
 * Good = selected is optimal / close; Risky = better option exists; Avoid = weak or strongly dominated.
 */
export function derivePickComment(args: {
  selectedPFinal: number | null;
  betterAlt: FrozenBetterAlternative | null;
  riskyGapPct?: number;
  avoidBelow?: number;
}): FrozenPickComment {
  const riskyGap = args.riskyGapPct ?? BETTER_ALTERNATIVE_THRESHOLD_PCT;
  const avoidBelow = args.avoidBelow ?? AVOID_P_FINAL;
  const selected = args.selectedPFinal;
  const alt = args.betterAlt;

  if (selected != null && selected < avoidBelow) {
    const better =
      alt && !alt.isOptimal
        ? ` Prefer ${alt.marketLabel} (${alt.predictionLabel}) at ${alt.pFinal}%.`
        : "";
    return {
      label: "avoid",
      message: `Avoid — selected confidence ${selected}% is below the ${avoidBelow}% safety floor.${better}`,
    };
  }

  if (alt && !alt.isOptimal && alt.deltaPct >= riskyGap * STRONG_DOMINANCE_MULT) {
    return {
      label: "avoid",
      message: `Avoid — engine strongly prefers ${alt.marketLabel} (${alt.predictionLabel}) by ${Math.round(alt.deltaPct)} pts.`,
    };
  }

  if (alt && !alt.isOptimal && alt.deltaPct >= riskyGap) {
    return {
      label: "risky",
      message: `Risky — plausible, but ${alt.marketLabel} (${alt.predictionLabel}) looks better at ${alt.pFinal}% (+${Math.round(alt.deltaPct)}).`,
    };
  }

  if (alt?.isOptimal || !alt || (alt.deltaPct ?? 0) < riskyGap) {
    return {
      label: "good",
      message:
        selected != null
          ? `Good — selected market aligns with the engine (≈${selected}%).`
          : "Good — selected market aligns with the engine.",
    };
  }

  return {
    label: "good",
    message: "Good — selected market aligns with the engine.",
  };
}

export function pickCommentEmoji(label: PickCommentLabel): string {
  if (label === "good") return "🟢";
  if (label === "risky") return "🟡";
  return "🔴";
}

export function pickCommentTitle(label: PickCommentLabel): string {
  if (label === "good") return "Good";
  if (label === "risky") return "Risky";
  return "Avoid";
}
