/**
 * Ligue 1 2026/27 season roster + per-team cards.
 * Roster is API-first — teams stay empty until verify overwrites from league 61.
 * Third promoted club is NOT hard-coded (reconcile from API).
 * Numerics are never invented — filled from DB/seed/live or left null.
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

export const L1_SEASON_2026_27 = "2026/27" as const;
export const L1_API_SEASON_2026 = 2026;
export const L1_LEAGUE_NAME = "Ligue 1";
export const L1_API_LEAGUE_ID = 61;
export const L1_EXPECTED_TEAM_COUNT = 18;
export const L1_PROMOTED_MIN_SAMPLES = 8;
export const L1_CONFIDENCE_MATCH_CAP = 20;

export type L1StyleLean = PlStyleLean;
export type L1StyleSeed = PlStyleSeed;
export type L1VenueSplit = PlVenueSplit;
export type L1TeamSeasonCard = PlTeamSeasonCard;

export interface L1SeasonRosterStore {
  schemaVersion: number;
  season: typeof L1_SEASON_2026_27;
  roster_verified: boolean;
  /** Empty until API verify overwrites with the live 18. */
  teams: string[];
  promoted: string[];
  relegated_out: string[];
  mismatches: Array<{ provisional: string; reason: string }>;
  cards: Record<string, L1TeamSeasonCard>;
  updatedAt: string;
  verifyError?: string | null;
}

export const L1_SEASON_ROSTER_SCHEMA_VERSION = 1;

/** Known promoted hints — third side from API only (do not hard-code Lorient/Paris FC/Metz). */
const BRIEF_PROMOTED_RAW = ["Troyes", "Le Mans"] as const;

/**
 * Clubs treated as prior-season / established top-flight for promotion detection.
 * Excludes Troyes / Le Mans (promoted hints).
 */
const BRIEF_PRIOR_SURVIVOR_RAW = [
  "Angers",
  "Brest",
  "Le Havre",
  "Lens",
  "Lille",
  "Lyon",
  "Marseille",
  "Monaco",
  "Nantes",
  "Nice",
  "Paris SG",
  "Rennes",
  "Strasbourg",
  "Toulouse",
  "Auxerre",
  "Reims",
] as const;

export const L1_2026_27_PROMOTED_HINTS: string[] = BRIEF_PROMOTED_RAW.map((t) =>
  standardizeTeamName(t)
);

export const L1_PRIOR_SEASON_SURVIVORS: string[] = BRIEF_PRIOR_SURVIVOR_RAW.map((t) =>
  standardizeTeamName(t)
);

export const L1_STYLE_SEEDS: Record<string, L1StyleSeed> = {
  "Paris SG": {
    summary: "Dominant attack and possession; heavy Over / BTTS / corners at home.",
    leans: ["over", "btts", "corners", "home_over"],
  },
  Marseille: {
    summary: "High-tempo attack; Over / BTTS lean.",
    leans: ["over", "btts"],
  },
  Monaco: {
    summary: "Attacking side; Over lean.",
    leans: ["over"],
  },
  Lyon: {
    summary: "Variable; Over / BTTS in open games.",
    leans: ["over", "btts"],
  },
  Lille: {
    summary: "Organised mid/top; slight Under lean when grinding.",
    leans: ["under"],
  },
  Nice: {
    summary: "Compact; Under lean.",
    leans: ["under"],
  },
  Troyes: {
    summary:
      "Recent Ligue 1 history — often lower-table, Under lean; qualitative only until samples.",
    leans: ["under"],
    notes: "No invented numerics from lower division.",
  },
  // Le Mans: intentionally no style_seed (thin recent top-flight data).
};

export function isL1PromotedHint(team: string): boolean {
  return L1_2026_27_PROMOTED_HINTS.includes(standardizeTeamName(team));
}

/** Promoted if explicit hint or not in prior-season survivor set. */
export function isL1PromotedTeam(
  team: string,
  rosterTeams?: string[] | null
): boolean {
  const name = standardizeTeamName(team);
  if (isL1PromotedHint(name)) return true;
  if (L1_PRIOR_SEASON_SURVIVORS.includes(name)) return false;
  if (rosterTeams?.length) return rosterTeams.includes(name);
  return false;
}

export function l1StyleSeedForTeam(team: string): L1StyleSeed | null {
  const name = standardizeTeamName(team);
  if (name === "Le Mans") return null;
  if (isL1PromotedHint(name) && name !== "Troyes") return null;
  return L1_STYLE_SEEDS[name] ?? null;
}

export function emptyL1TeamSeasonCard(
  team: string,
  opts?: { seed_paused?: boolean; is_promoted?: boolean }
): L1TeamSeasonCard {
  const name = standardizeTeamName(team);
  const is_promoted = opts?.is_promoted ?? isL1PromotedTeam(name);
  return {
    team: name,
    season: L1_SEASON_2026_27,
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
    style_seed: l1StyleSeedForTeam(name),
    data_confidence: computeDataConfidence(null, is_promoted),
    seed_paused: opts?.seed_paused,
  };
}

export function emptyL1SeasonRosterStore(): L1SeasonRosterStore {
  return {
    schemaVersion: L1_SEASON_ROSTER_SCHEMA_VERSION,
    season: L1_SEASON_2026_27,
    roster_verified: false,
    teams: [],
    promoted: [...L1_2026_27_PROMOTED_HINTS],
    relegated_out: [],
    mismatches: [],
    cards: {},
    updatedAt: new Date().toISOString(),
    verifyError: null,
  };
}

export function l1CardKey(team: string): string {
  return standardizeTeamName(team);
}

export function getL1CardFromStore(
  store: L1SeasonRosterStore | null | undefined,
  team: string
): L1TeamSeasonCard | null {
  if (!store?.cards) return null;
  return store.cards[l1CardKey(team)] ?? null;
}

export { computeDataConfidence, emptyVenueSplit, styleSeedAlign };
