/**
 * La Liga 2026/27 season roster + per-team cards.
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

export const LL_SEASON_2026_27 = "2026/27" as const;
export const LL_API_SEASON_2026 = 2026;
export const LL_LEAGUE_NAME = "La Liga";
export const LL_API_LEAGUE_ID = 140;
export const LL_PROMOTED_MIN_SAMPLES = 8;
export const LL_CONFIDENCE_MATCH_CAP = 20;

/** Reuse PL card/seed shapes for hybrid wiring. */
export type LlStyleLean = PlStyleLean;
export type LlStyleSeed = PlStyleSeed;
export type LlVenueSplit = PlVenueSplit;
export type LlTeamSeasonCard = PlTeamSeasonCard;

export interface LlSeasonRosterStore {
  schemaVersion: number;
  season: typeof LL_SEASON_2026_27;
  roster_verified: boolean;
  teams: string[];
  promoted: string[];
  relegated_out: string[];
  mismatches: Array<{ provisional: string; reason: string }>;
  cards: Record<string, LlTeamSeasonCard>;
  updatedAt: string;
  verifyError?: string | null;
}

export const LL_SEASON_ROSTER_SCHEMA_VERSION = 1;

const BRIEF_TEAMS_RAW = [
  "Athletic Club",
  "Atlético Madrid",
  "Real Madrid",
  "Barcelona",
  "Real Sociedad",
  "Sevilla",
  "Villarreal",
  "Valencia",
  "Real Betis",
  "Celta Vigo",
  "Osasuna",
  "Deportivo Alavés",
  "Elche",
  "Getafe",
  "Rayo Vallecano",
  "Espanyol",
  "Levante",
  "Racing Santander",
  "Deportivo La Coruña",
  "Málaga",
] as const;

const BRIEF_PROMOTED_RAW = [
  "Racing Santander",
  "Deportivo La Coruña",
  "Málaga",
] as const;

/** Best-guess relegations from 2025/26 — verify may overwrite roster. */
const BRIEF_RELEGATED_RAW = ["Girona", "Las Palmas", "Leganes"] as const;

export const LL_2026_27_PROVISIONAL_TEAMS: string[] = BRIEF_TEAMS_RAW.map((t) =>
  standardizeTeamName(t)
);

export const LL_2026_27_PROMOTED: string[] = BRIEF_PROMOTED_RAW.map((t) =>
  standardizeTeamName(t)
);

export const LL_2026_27_RELEGATED_OUT: string[] = BRIEF_RELEGATED_RAW.map((t) =>
  standardizeTeamName(t)
);

export const LL_STYLE_SEEDS: Record<string, LlStyleSeed> = {
  "Real Madrid": {
    summary:
      "High goals-for, strong away; frequent Over in open games but can grind low-scoring wins.",
    leans: ["over"],
    notes: "Do not overweight corner→goal on volume alone.",
  },
  Barcelona: {
    summary:
      "High possession, high goals-for, elevated BTTS in high-line seasons; strong corner volume.",
    leans: ["over", "btts", "corners"],
  },
  "Ath Madrid": {
    summary: "Historically low-scoring, defensively strong, elevated Under / clean sheets.",
    leans: ["under"],
    notes: "Cautious BTTS.",
  },
  "Ath Bilbao": {
    summary: "Physical, strong set-piece and corner presence, competitive at home.",
    leans: ["corners", "home_over"],
  },
  Sociedad: {
    summary: "Attacking mid-table side, moderate-to-high BTTS. Neutral-to-Over.",
    leans: ["over", "btts"],
  },
  Villarreal: {
    summary: "Attacking mid-table side, moderate-to-high BTTS. Neutral-to-Over.",
    leans: ["over", "btts"],
  },
  Betis: {
    summary: "Attacking mid-table side, moderate-to-high BTTS. Neutral-to-Over.",
    leans: ["over", "btts"],
  },
  Sevilla: {
    summary: "Variable season-to-season; slight Under lean with DB lead.",
    leans: ["under"],
  },
  Valencia: {
    summary: "Variable; slight Under lean with DB lead.",
    leans: ["under"],
  },
  Getafe: {
    summary: "Historically low-scoring / physical. Under lean.",
    leans: ["under"],
  },
  Vallecano: {
    summary: "Open games; BTTS lean.",
    leans: ["btts"],
  },
};

export function isLlPromotedTeam(team: string): boolean {
  return LL_2026_27_PROMOTED.includes(standardizeTeamName(team));
}

export function llStyleSeedForTeam(team: string): LlStyleSeed | null {
  return LL_STYLE_SEEDS[standardizeTeamName(team)] ?? null;
}

export function emptyLlTeamSeasonCard(
  team: string,
  opts?: { seed_paused?: boolean }
): LlTeamSeasonCard {
  const name = standardizeTeamName(team);
  const is_promoted = isLlPromotedTeam(name);
  return {
    team: name,
    season: LL_SEASON_2026_27,
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
    style_seed: llStyleSeedForTeam(name),
    data_confidence: computeDataConfidence(null, is_promoted),
    seed_paused: opts?.seed_paused,
  };
}

export function emptyLlSeasonRosterStore(): LlSeasonRosterStore {
  const cards: Record<string, LlTeamSeasonCard> = {};
  for (const team of LL_2026_27_PROVISIONAL_TEAMS) {
    cards[team] = emptyLlTeamSeasonCard(team);
  }
  return {
    schemaVersion: LL_SEASON_ROSTER_SCHEMA_VERSION,
    season: LL_SEASON_2026_27,
    roster_verified: false,
    teams: [...LL_2026_27_PROVISIONAL_TEAMS],
    promoted: [...LL_2026_27_PROMOTED],
    relegated_out: [...LL_2026_27_RELEGATED_OUT],
    mismatches: [],
    cards,
    updatedAt: new Date().toISOString(),
    verifyError: null,
  };
}

export function llCardKey(team: string): string {
  return standardizeTeamName(team);
}

export function getLlCardFromStore(
  store: LlSeasonRosterStore | null | undefined,
  team: string
): LlTeamSeasonCard | null {
  if (!store?.cards) return null;
  return store.cards[llCardKey(team)] ?? null;
}

export { computeDataConfidence, emptyVenueSplit, styleSeedAlign };
