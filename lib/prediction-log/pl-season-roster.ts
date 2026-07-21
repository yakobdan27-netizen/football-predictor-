/**
 * Premier League 2026/27 season roster + per-team cards.
 * Numerics are never invented — filled from DB/seed/live or left null.
 * Style seeds are qualitative leans only (system-half nudge).
 */
import { standardizeTeamName } from "@/lib/data/team-names";

export const PL_SEASON_2026_27 = "2026/27" as const;
export const PL_API_SEASON_2026 = 2026;
export const PL_LEAGUE_NAME = "Premier League";
export const PL_PROMOTED_MIN_SAMPLES = 8;
export const PL_CONFIDENCE_MATCH_CAP = 20;

/** Directional market leans — not numeric rates. */
export type PlStyleLean =
  | "over"
  | "under"
  | "btts"
  | "corners"
  | "home_over"
  | "neutral";

export interface PlStyleSeed {
  summary: string;
  leans: PlStyleLean[];
  notes?: string;
}

export interface PlVenueSplit {
  goals_pg: number | null;
  conceded_pg: number | null;
}

export interface PlTeamSeasonCard {
  team: string;
  season: typeof PL_SEASON_2026_27;
  is_promoted: boolean;
  matches_played: number | null;
  goals_scored_pg: number | null;
  goals_conceded_pg: number | null;
  over_2_5_rate: number | null;
  btts_rate: number | null;
  corners_won_pg: number | null;
  corners_conceded_pg: number | null;
  first_half_goal_rate: number | null;
  second_half_goal_rate: number | null;
  conceded_half_goals: number | null;
  home_split: PlVenueSplit;
  away_split: PlVenueSplit;
  style_seed: PlStyleSeed | null;
  data_confidence: number;
  /** True when API roster verify could not confirm this provisional name. */
  seed_paused?: boolean;
}

export interface PlSeasonRosterStore {
  schemaVersion: number;
  season: typeof PL_SEASON_2026_27;
  roster_verified: boolean;
  teams: string[];
  promoted: string[];
  relegated_out: string[];
  mismatches: Array<{ provisional: string; reason: string }>;
  cards: Record<string, PlTeamSeasonCard>;
  updatedAt: string;
  verifyError?: string | null;
}

export const PL_SEASON_ROSTER_SCHEMA_VERSION = 1;

/** Brief lineup (display names) — standardized on load. */
const BRIEF_TEAMS_RAW = [
  "Arsenal",
  "Aston Villa",
  "Bournemouth",
  "Brentford",
  "Brighton & Hove Albion",
  "Chelsea",
  "Coventry City",
  "Crystal Palace",
  "Everton",
  "Fulham",
  "Hull City",
  "Ipswich Town",
  "Leeds United",
  "Liverpool",
  "Manchester City",
  "Manchester United",
  "Newcastle United",
  "Nottingham Forest",
  "Sunderland",
  "Tottenham Hotspur",
] as const;

const BRIEF_PROMOTED_RAW = ["Coventry City", "Ipswich Town", "Hull City"] as const;
const BRIEF_RELEGATED_RAW = [
  "Wolverhampton Wanderers",
  "Burnley",
  "West Ham United",
] as const;

export const PL_2026_27_PROVISIONAL_TEAMS: string[] = BRIEF_TEAMS_RAW.map((t) =>
  standardizeTeamName(t)
);

export const PL_2026_27_PROMOTED: string[] = BRIEF_PROMOTED_RAW.map((t) =>
  standardizeTeamName(t)
);

export const PL_2026_27_RELEGATED_OUT: string[] = BRIEF_RELEGATED_RAW.map((t) =>
  standardizeTeamName(t)
);

/** Qualitative style seeds keyed by standardized app team name. */
export const PL_STYLE_SEEDS: Record<string, PlStyleSeed> = {
  "Man City": {
    summary:
      "High possession, high xG, strong corner volume. Lean Over / team-goals.",
    leans: ["over", "corners"],
    notes: "Corner→goal conversion moderate — do not overweight.",
  },
  Arsenal: {
    summary: "League-leading corner volume, strong set-piece threat. Lean corners + Over.",
    leans: ["corners", "over"],
    notes: "PL set-piece conversion fell in 24/25 — do not overweight corner-goal on volume alone.",
  },
  Liverpool: {
    summary: "High tempo, high BTTS both ends, strong 2nd-half goals.",
    leans: ["over", "btts"],
  },
  Tottenham: {
    summary: "Open, high-variance, both boxes busy. Lean Over / BTTS.",
    leans: ["over", "btts"],
    notes: "Volatile defensively.",
  },
  Newcastle: {
    summary: "Physical, set-piece heavy, strong at home. Lean corners + home Over.",
    leans: ["corners", "home_over"],
  },
  Brentford: {
    summary: "Set-piece specialists, direct. Corner and BTTS lean.",
    leans: ["corners", "btts"],
  },
  "Aston Villa": {
    summary: "Aggressive transitions, decent Over profile. Neutral-to-Over.",
    leans: ["over"],
  },
  Chelsea: {
    summary: "High shot volume, inconsistent finishing. Corners lean; Over only when DB confirms.",
    leans: ["corners"],
  },
  "Man United": {
    summary: "Variable season-to-season — stay neutral, let team data lead.",
    leans: ["neutral"],
  },
  Everton: {
    summary: "Low-scoring, defensively organised. Lean Under / lower-corner.",
    leans: ["under"],
  },
  "Crystal Palace": {
    summary: "Counter-attacking, mid corner volume. Neutral.",
    leans: ["neutral"],
  },
  Fulham: {
    summary: "Balanced, mid-table profile. Neutral, DB-led.",
    leans: ["neutral"],
  },
  Brighton: {
    summary: "High xG creation, sometimes low conversion. Lean Over on chances, verify with DB.",
    leans: ["over"],
  },
  Bournemouth: {
    summary: "Aggressive press, open games. Slight Over lean.",
    leans: ["over"],
  },
  "Nott'm Forest": {
    summary: "Compact, counter, lower-event. Lean Under-leaning / neutral.",
    leans: ["under", "neutral"],
  },
};

export function isPlPromotedTeam(team: string): boolean {
  const key = standardizeTeamName(team);
  return PL_2026_27_PROMOTED.includes(key);
}

export function styleSeedForTeam(team: string): PlStyleSeed | null {
  return PL_STYLE_SEEDS[standardizeTeamName(team)] ?? null;
}

export function emptyVenueSplit(): PlVenueSplit {
  return { goals_pg: null, conceded_pg: null };
}

export function computeDataConfidence(
  matchesPlayed: number | null,
  isPromoted: boolean
): number {
  const n = matchesPlayed ?? 0;
  let conf = Math.min(1, Math.max(0, n / PL_CONFIDENCE_MATCH_CAP));
  if (isPromoted && n < PL_PROMOTED_MIN_SAMPLES) {
    conf *= 0.5;
  }
  return Math.round(conf * 1000) / 1000;
}

export function emptyTeamSeasonCard(
  team: string,
  opts?: { seed_paused?: boolean }
): PlTeamSeasonCard {
  const name = standardizeTeamName(team);
  const is_promoted = isPlPromotedTeam(name);
  return {
    team: name,
    season: PL_SEASON_2026_27,
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
    style_seed: styleSeedForTeam(name),
    data_confidence: computeDataConfidence(null, is_promoted),
    seed_paused: opts?.seed_paused,
  };
}

export function emptyPlSeasonRosterStore(): PlSeasonRosterStore {
  const cards: Record<string, PlTeamSeasonCard> = {};
  for (const team of PL_2026_27_PROVISIONAL_TEAMS) {
    cards[team] = emptyTeamSeasonCard(team);
  }
  return {
    schemaVersion: PL_SEASON_ROSTER_SCHEMA_VERSION,
    season: PL_SEASON_2026_27,
    roster_verified: false,
    teams: [...PL_2026_27_PROVISIONAL_TEAMS],
    promoted: [...PL_2026_27_PROMOTED],
    relegated_out: [...PL_2026_27_RELEGATED_OUT],
    mismatches: [],
    cards,
    updatedAt: new Date().toISOString(),
    verifyError: null,
  };
}

export function cardKey(team: string): string {
  return standardizeTeamName(team);
}

export function getCardFromStore(
  store: PlSeasonRosterStore | null | undefined,
  team: string
): PlTeamSeasonCard | null {
  if (!store?.cards) return null;
  return store.cards[cardKey(team)] ?? null;
}

/** Style lean nudge for a market prediction (−1 fights, 0 neutral, +1 aligns). */
export function styleSeedAlign(
  seed: PlStyleSeed | null,
  marketKey: string,
  prediction: string
): number {
  if (!seed) return 0;
  if (seed.leans.length === 1 && seed.leans[0] === "neutral") return 0;
  const pred = prediction.toLowerCase();
  const key = marketKey.toLowerCase();
  const leans = new Set(seed.leans);

  if (key.includes("corner")) {
    if (leans.has("corners")) return pred.includes("under") ? -1 : 1;
    if (leans.has("under")) return pred.includes("under") ? 1 : -1;
  }
  if (key.includes("btts")) {
    if (leans.has("btts")) return pred.includes("no") ? -1 : 1;
  }
  if (key.includes("total_goals") || key.includes("goals_ou") || pred.includes("over") || pred.includes("under")) {
    if (leans.has("over") || leans.has("home_over")) {
      return pred.includes("under") ? -1 : 1;
    }
    if (leans.has("under")) {
      return pred.includes("under") ? 1 : pred.includes("over") ? -1 : 0;
    }
  }
  return 0;
}
