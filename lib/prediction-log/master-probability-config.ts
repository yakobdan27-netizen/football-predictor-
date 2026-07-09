import type { LogMarketKey } from "./types";
import type { ClubCapacity } from "./club-record-types";

export type ConfidenceBand = "strong" | "solid" | "coin_flip" | "avoid";

export const FORMULA_CONFIG = {
  K_fullTrustSampleSize: 8,
  baseWeights: { cap: 0.32, form: 0.22, h2h: 0.18, you: 0.23, luck: 0.05 },
  odds: { safeThreshold: 6, spread: 20 },
  lambda_riskSensitivity: 0.45,
  riskCeiling: 0.60,
  confidenceFloor: 55,
  luckMaxInfluence: 0.05,
} as const;

export interface CapacityFieldMapping {
  attackField: (cap: ClubCapacity, venue: "home" | "away") => number;
  defenseField: (cap: ClubCapacity, venue: "home" | "away") => number;
  scale: number;
}

function winAttack(cap: ClubCapacity, venue: "home" | "away"): number {
  return venue === "home" ? cap.homeWinRate / 100 : cap.awayWinRate / 100;
}
function winDefense(cap: ClubCapacity, venue: "home" | "away"): number {
  const oppVenue = venue === "home" ? "away" : "home";
  return 1 - (oppVenue === "away" ? cap.awayWinRate / 100 : cap.homeWinRate / 100);
}

const WIN_MAPPING: CapacityFieldMapping = {
  attackField: winAttack,
  defenseField: winDefense,
  scale: 0.25,
};

const GOALS_MAPPING: CapacityFieldMapping = {
  attackField: (cap) => cap.avgGoalsScored,
  defenseField: (cap) => cap.avgGoalsConceded,
  scale: 1.5,
};

const SOT_MAPPING: CapacityFieldMapping = {
  attackField: (cap) => cap.avgShotsOnTarget,
  defenseField: (cap) => cap.avgGoalsConceded,
  scale: 3,
};

const CORNERS_MAPPING: CapacityFieldMapping = {
  attackField: (cap) => cap.avgCorners,
  defenseField: (cap) => cap.avgCorners,
  scale: 3,
};

const CARDS_MAPPING: CapacityFieldMapping = {
  attackField: (cap) => cap.avgYellowCards,
  defenseField: (cap) => cap.avgFouls / 10,
  scale: 2,
};

const OFFSIDES_MAPPING: CapacityFieldMapping = {
  attackField: (cap) => cap.avgOffsides,
  defenseField: (cap) => cap.avgOffsides,
  scale: 3,
};

const SHOTS_MAPPING: CapacityFieldMapping = {
  attackField: (cap) => cap.avgShotsOnTarget * 2.5,
  defenseField: (cap) => cap.avgGoalsConceded,
  scale: 3,
};

export const CAPACITY_FIELD_MAP: Partial<Record<LogMarketKey, CapacityFieldMapping>> = {
  "1x2": WIN_MAPPING,
  ht_1x2: WIN_MAPPING,
  win_one_half: WIN_MAPPING,
  double_chance: WIN_MAPPING,
  btts: GOALS_MAPPING,
  home_goals_ou: GOALS_MAPPING,
  away_goals_ou: GOALS_MAPPING,
  more_goals_half: GOALS_MAPPING,
  draw_one_half: WIN_MAPPING,
  sot_ou: SOT_MAPPING,
  shots_ou: SHOTS_MAPPING,
  corners_ou: CORNERS_MAPPING,
  throw_ins_ou: CORNERS_MAPPING,
  offsides_ou: OFFSIDES_MAPPING,
};

export function confidenceBand(pFinal: number): ConfidenceBand {
  if (pFinal >= 75) return "strong";
  if (pFinal >= 60) return "solid";
  if (pFinal >= 50) return "coin_flip";
  return "avoid";
}

export function confidenceBandLabel(band: ConfidenceBand): string {
  switch (band) {
    case "strong":
      return "Strong";
    case "solid":
      return "Solid";
    case "coin_flip":
      return "Coin-flip";
    case "avoid":
      return "Avoid";
  }
}

export const CONFIDENCE_BAND_COLORS: Record<ConfidenceBand, string> = {
  strong: "var(--accent)",
  solid: "#c0a030",
  coin_flip: "var(--warn)",
  avoid: "var(--danger)",
};
