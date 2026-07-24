/**
 * Serie A 2026/27 season roster + per-team cards.
 * Numerics are never invented — filled from DB/seed/live or left null.
 * Style seeds are qualitative leans only (system-half nudge).
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import type {
  PlStyleLean,
  PlStyleSeed,
  PlTeamSeasonCard,
  PlVenueSplit,
} from "./pl-season-roster";
import {
  computeDataConfidence,
  emptyVenueSplit,
  styleSeedAlign,
} from "./pl-season-roster";

export const SA_SEASON_2026_27 = "2026/27" as const;
export const SA_API_SEASON_2026 = 2026;
export const SA_LEAGUE_NAME = "Serie A";
export const SA_API_LEAGUE_ID = 135;
export const SA_PROMOTED_MIN_SAMPLES = 8;
export const SA_CONFIDENCE_MATCH_CAP = 20;

export type SaStyleLean = PlStyleLean;
export type SaStyleSeed = PlStyleSeed;
export type SaVenueSplit = PlVenueSplit;
export type SaTeamSeasonCard = PlTeamSeasonCard;

export interface SaSeasonRosterStore {
  schemaVersion: number;
  season: typeof SA_SEASON_2026_27;
  roster_verified: boolean;
  teams: string[];
  promoted: string[];
  relegated_out: string[];
  mismatches: Array<{ provisional: string; reason: string }>;
  cards: Record<string, SaTeamSeasonCard>;
  updatedAt: string;
  verifyError?: string | null;
}

export const SA_SEASON_ROSTER_SCHEMA_VERSION = 1;

/** Confirmed 2026/27 Serie A 20 (survivors + Venezia / Frosinone / Monza). */
const BRIEF_TEAMS_RAW = [
  "Atalanta",
  "Bologna",
  "Cagliari",
  "Como",
  "Fiorentina",
  "Frosinone",
  "Genoa",
  "Inter",
  "Juventus",
  "Lazio",
  "Lecce",
  "Milan",
  "Monza",
  "Napoli",
  "Parma",
  "Roma",
  "Sassuolo",
  "Torino",
  "Udinese",
  "Venezia",
] as const;

const BRIEF_PROMOTED_RAW = ["Venezia", "Frosinone", "Monza"] as const;

const BRIEF_RELEGATED_RAW = ["Cremonese", "Pisa", "Verona"] as const;

export const SA_2026_27_PROVISIONAL_TEAMS: string[] = BRIEF_TEAMS_RAW.map((t) =>
  standardizeTeamName(t)
);

export const SA_2026_27_PROMOTED: string[] = BRIEF_PROMOTED_RAW.map((t) =>
  standardizeTeamName(t)
);

export const SA_2026_27_RELEGATED_OUT: string[] = BRIEF_RELEGATED_RAW.map((t) =>
  standardizeTeamName(t)
);

export const SA_STYLE_SEEDS: Record<string, SaStyleSeed> = {
  Inter: {
    summary: "Dominant possession and high shot volume; Over / BTTS at home.",
    leans: ["over", "btts", "home_over"],
  },
  Milan: {
    summary: "Attacking big club; Over lean with variable BTTS.",
    leans: ["over"],
  },
  Juventus: {
    summary: "Historically compact; slight Under lean when grinding.",
    leans: ["under"],
  },
  Napoli: {
    summary: "High-tempo attack; Over / BTTS in open games.",
    leans: ["over", "btts"],
  },
  Atalanta: {
    summary: "High-press, high goals both ways; Over / BTTS / corners.",
    leans: ["over", "btts", "corners"],
  },
  Roma: {
    summary: "Variable; mid-table Over / BTTS lean.",
    leans: ["over", "btts"],
  },
  Lazio: {
    summary: "Attacking mid-table; Over lean.",
    leans: ["over"],
  },
  Fiorentina: {
    summary: "Open mid-table games; BTTS lean.",
    leans: ["btts"],
  },
  Venezia: {
    summary:
      "Recent Serie A spells — often open, BTTS-leaning when promoted; qualitative only until samples.",
    leans: ["btts", "over"],
    notes: "No invented numerics from Serie B.",
  },
  Frosinone: {
    summary:
      "Recent Serie A spells — lower-table profile, Under lean when compact.",
    leans: ["under"],
    notes: "Qualitative only until 2026/27 matches.",
  },
  Monza: {
    summary:
      "Recent Serie A spells — possession-oriented mid-table; slight Under / BTTS mix.",
    leans: ["under", "btts"],
    notes: "Qualitative only until 2026/27 matches.",
  },
};

export function isSaPromotedTeam(team: string): boolean {
  return SA_2026_27_PROMOTED.includes(standardizeTeamName(team));
}

export function saStyleSeedForTeam(team: string): SaStyleSeed | null {
  return SA_STYLE_SEEDS[standardizeTeamName(team)] ?? null;
}

export function emptySaTeamSeasonCard(
  team: string,
  opts?: { seed_paused?: boolean }
): SaTeamSeasonCard {
  const name = standardizeTeamName(team);
  const is_promoted = isSaPromotedTeam(name);
  return {
    team: name,
    season: SA_SEASON_2026_27,
    is_promoted,
    matches_played: null,
    goals_scored_pg: null,
    goals_conceded_pg: null,
    over_2_5_rate: null,
    btts_rate: null,
    corners_won_pg: null,
    corners_conceded_pg: null,
    first_half_goal_rate: null,
    second_half_goal_rate: null,
    conceded_half_goals: null,
    home_split: emptyVenueSplit(),
    away_split: emptyVenueSplit(),
    style_seed: saStyleSeedForTeam(name),
    data_confidence: computeDataConfidence(null, is_promoted),
    seed_paused: opts?.seed_paused,
  };
}

export function emptySaSeasonRosterStore(): SaSeasonRosterStore {
  const cards: Record<string, SaTeamSeasonCard> = {};
  for (const team of SA_2026_27_PROVISIONAL_TEAMS) {
    cards[team] = emptySaTeamSeasonCard(team);
  }
  return {
    schemaVersion: SA_SEASON_ROSTER_SCHEMA_VERSION,
    season: SA_SEASON_2026_27,
    roster_verified: false,
    teams: [...SA_2026_27_PROVISIONAL_TEAMS],
    promoted: [...SA_2026_27_PROMOTED],
    relegated_out: [...SA_2026_27_RELEGATED_OUT],
    mismatches: [],
    cards,
    updatedAt: new Date().toISOString(),
    verifyError: null,
  };
}

export function saCardKey(team: string): string {
  return standardizeTeamName(team);
}

export function getSaCardFromStore(
  store: SaSeasonRosterStore | null | undefined,
  team: string
): SaTeamSeasonCard | null {
  if (!store?.cards) return null;
  return store.cards[saCardKey(team)] ?? null;
}

export { computeDataConfidence, emptyVenueSplit, styleSeedAlign };
