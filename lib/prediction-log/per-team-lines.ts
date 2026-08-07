/**
 * Per-team corner & HT-goal O/U lines — read-side only.
 * Uses the same Poisson O/U rule and the same per-side intensities
 * the totals already compute. Never rewrites totals math.
 */
import { overUnderFromLambda } from "./goal-distribution";
import type { CornersConfidence, CornersMatchPrediction } from "./corners-model";
import type { HshConfidence, HshPrediction } from "./hsh-model";

export const PER_TEAM_LINES = {
  corners: {
    homeDefault: 5.5,
    awayDefault: 4.5,
    alternates: [3.5, 4.5, 5.5, 6.5, 7.5],
  },
  halfGoals: {
    homeDefault: 0.5,
    awayDefault: 0.5,
    alternates: [0.5, 1.5],
    totalDefault: 1.5,
  },
} as const;

export type IntensitySource = "api_db" | "live" | "seed" | "missing";

export type PerTeamLineLean = "over" | "under" | "push";

export type PerTeamLineResult = {
  side: "home" | "away";
  market: "corners" | "halfGoals";
  line: number;
  intensity: number | null;
  overPct: number | null;
  underPct: number | null;
  lean: PerTeamLineLean | null;
  leanPct: number | null;
  confidence: "high" | "medium" | "low";
  source: IntensitySource;
  insufficient: boolean;
};

export type TotalOuDisplay = {
  label: string;
  line: number;
  overPct: number;
  underPct: number;
  lean: PerTeamLineLean;
  leanPct: number;
  confidence: "high" | "medium" | "low";
};

export type PerTeamLinesSelection = {
  cornersHome: number;
  cornersAway: number;
  htHome: number;
  htAway: number;
  htTotal: number;
};

export function defaultPerTeamSelection(): PerTeamLinesSelection {
  return {
    cornersHome: PER_TEAM_LINES.corners.homeDefault,
    cornersAway: PER_TEAM_LINES.corners.awayDefault,
    htHome: PER_TEAM_LINES.halfGoals.homeDefault,
    htAway: PER_TEAM_LINES.halfGoals.awayDefault,
    htTotal: PER_TEAM_LINES.halfGoals.totalDefault,
  };
}

/** Infer source badge from rate note / sample flags (display only). */
export function inferIntensitySource(
  sourceNote: string | null | undefined,
  opts?: { sampleSize?: number; seasonCountHint?: boolean }
): IntensitySource {
  const note = (sourceNote ?? "").toLowerCase();
  if (!note && (opts?.sampleSize == null || opts.sampleSize <= 0)) {
    return "missing";
  }
  if (!note && opts?.sampleSize != null && opts.sampleSize <= 0) return "missing";
  if (note.includes("db") || note.includes("hist") || note.includes("api")) {
    return note.includes("live") ? "live" : "api_db";
  }
  if (note.includes("live")) return "live";
  if (note) return "seed";
  // League-default fallback with no seed note → treat as missing for per-team honesty
  return "missing";
}

export function sourceBadgeLabel(source: IntensitySource): string {
  switch (source) {
    case "api_db":
      return "API";
    case "live":
      return "Live";
    case "seed":
      return "Seed";
    case "missing":
      return "INSUFFICIENT DATA";
  }
}

/**
 * Price a single per-team O/U line. Returns insufficient when source is missing
 * (does not invent a probability from a floored league-default λ).
 */
export function buildPerTeamLine(opts: {
  side: "home" | "away";
  market: "corners" | "halfGoals";
  intensity: number | null | undefined;
  line: number;
  source: IntensitySource;
  confidence: "high" | "medium" | "low";
}): PerTeamLineResult {
  const { side, market, line, source, confidence } = opts;
  const intensity =
    opts.intensity != null && Number.isFinite(opts.intensity) ? opts.intensity : null;

  if (source === "missing" || intensity == null) {
    return {
      side,
      market,
      line,
      intensity: null,
      overPct: null,
      underPct: null,
      lean: null,
      leanPct: null,
      confidence,
      source: "missing",
      insufficient: true,
    };
  }

  const [over, under] = overUnderFromLambda(intensity, line);
  const lean: PerTeamLineLean =
    over > under + 0.02 ? "over" : under > over + 0.02 ? "under" : "push";
  const leanPct = lean === "over" ? over : lean === "under" ? under : Math.max(over, under);

  return {
    side,
    market,
    line,
    intensity,
    overPct: over,
    underPct: under,
    lean,
    leanPct,
    confidence,
    source,
    insufficient: false,
  };
}

function mapCornersConfidence(c: CornersConfidence): "high" | "medium" | "low" {
  return c;
}

function mapHshConfidence(c: HshConfidence): "high" | "medium" | "low" {
  return c;
}

export function buildCornersPerTeamBundle(
  pred: CornersMatchPrediction,
  lines: { home: number; away: number }
): { home: PerTeamLineResult; away: PerTeamLineResult } {
  const conf = mapCornersConfidence(pred.confidence);
  const homeSource = inferIntensitySource(pred.detail.seedHome);
  const awaySource = inferIntensitySource(pred.detail.seedAway);

  return {
    home: buildPerTeamLine({
      side: "home",
      market: "corners",
      intensity: pred.lambdaHome,
      line: lines.home,
      source: homeSource,
      confidence: conf,
    }),
    away: buildPerTeamLine({
      side: "away",
      market: "corners",
      intensity: pred.lambdaAway,
      line: lines.away,
      source: awaySource,
      confidence: conf,
    }),
  };
}

export function buildHtTotalDisplay(
  pred: HshPrediction,
  line: number = PER_TEAM_LINES.halfGoals.totalDefault
): TotalOuDisplay {
  const [over, under] = overUnderFromLambda(pred.lambda1h, line);
  const lean: PerTeamLineLean =
    over > under + 0.02 ? "over" : under > over + 0.02 ? "under" : "push";
  return {
    label: "TOTAL HT GOALS",
    line,
    overPct: over,
    underPct: under,
    lean,
    leanPct: lean === "over" ? over : lean === "under" ? under : Math.max(over, under),
    confidence: mapHshConfidence(pred.confidence),
  };
}

export function buildHtPerTeamBundle(
  pred: HshPrediction,
  lines: { home: number; away: number }
): { home: PerTeamLineResult; away: PerTeamLineResult } {
  const conf = mapHshConfidence(pred.confidence);
  const homeSource = inferIntensitySource(pred.detail.seedHome, {
    sampleSize: pred.sampleSizeHome,
  });
  const awaySource = inferIntensitySource(pred.detail.seedAway, {
    sampleSize: pred.sampleSizeAway,
  });

  return {
    home: buildPerTeamLine({
      side: "home",
      market: "halfGoals",
      intensity: pred.detail.lambdaA1,
      line: lines.home,
      source: homeSource,
      confidence: conf,
    }),
    away: buildPerTeamLine({
      side: "away",
      market: "halfGoals",
      intensity: pred.detail.lambdaB1,
      line: lines.away,
      source: awaySource,
      confidence: conf,
    }),
  };
}

export function formatLeanLabel(lean: PerTeamLineLean | null, line: number): string {
  if (lean === "over") return `Over ${line}`;
  if (lean === "under") return `Under ${line}`;
  if (lean === "push") return `Push ${line}`;
  return `O/U ${line}`;
}

export function pctLabel(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${Math.round(p * 100)}%`;
}
