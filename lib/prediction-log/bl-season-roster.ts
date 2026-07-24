/**
 * Bundesliga 2026/27 season roster + per-team cards.
 * Roster is API-first — teams stay empty until verify overwrites from league 78.
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

export const BL_SEASON_2026_27 = "2026/27" as const;
export const BL_API_SEASON_2026 = 2026;
export const BL_LEAGUE_NAME = "Bundesliga";
export const BL_API_LEAGUE_ID = 78;
export const BL_EXPECTED_TEAM_COUNT = 18;
export const BL_PROMOTED_MIN_SAMPLES = 8;
export const BL_CONFIDENCE_MATCH_CAP = 20;

/** Reuse PL card/seed shapes for hybrid wiring. */
export type BlStyleLean = PlStyleLean;
export type BlStyleSeed = PlStyleSeed;
export type BlVenueSplit = PlVenueSplit;
export type BlTeamSeasonCard = PlTeamSeasonCard;

export interface BlSeasonRosterStore {
  schemaVersion: number;
  season: typeof BL_SEASON_2026_27;
  roster_verified: boolean;
  /** Empty until API verify overwrites with the live 18. */
  teams: string[];
  promoted: string[];
  relegated_out: string[];
  mismatches: Array<{ provisional: string; reason: string }>;
  cards: Record<string, BlTeamSeasonCard>;
  updatedAt: string;
  verifyError?: string | null;
}

export const BL_SEASON_ROSTER_SCHEMA_VERSION = 1;

/** Known promoted hints — remaining sides come from API only. */
const BRIEF_PROMOTED_RAW = ["Paderborn"] as const;

/** Clubs with uncertain status across sources — log RECONCILE on verify. */
const BRIEF_RECONCILE_RAW = ["Wolfsburg", "Heidenheim"] as const;

/** Best-guess relegations — verify may overwrite; Wolfsburg is RECONCILE not hard-coded. */
const BRIEF_RELEGATED_RAW = [] as const;

/**
 * Clubs treated as prior-season / established top-flight for promotion detection.
 * Includes Wolfsburg + Heidenheim as survivors until API reconcile (not auto-promoted).
 */
const BRIEF_PRIOR_SURVIVOR_RAW = [
  "Augsburg",
  "Bayern Munich",
  "Bochum",
  "Dortmund",
  "Ein Frankfurt",
  "FC Koln",
  "Freiburg",
  "Heidenheim",
  "Hoffenheim",
  "Holstein Kiel",
  "Leverkusen",
  "M'gladbach",
  "Mainz",
  "RB Leipzig",
  "St Pauli",
  "Stuttgart",
  "Union Berlin",
  "Werder Bremen",
  "Wolfsburg",
] as const;

export const BL_2026_27_PROMOTED_HINTS: string[] = BRIEF_PROMOTED_RAW.map((t) =>
  standardizeTeamName(t)
);

export const BL_2026_27_RECONCILE: string[] = BRIEF_RECONCILE_RAW.map((t) =>
  standardizeTeamName(t)
);

export const BL_2026_27_RELEGATED_OUT: string[] = BRIEF_RELEGATED_RAW.map((t) =>
  standardizeTeamName(t)
);

export const BL_PRIOR_SEASON_SURVIVORS: string[] = BRIEF_PRIOR_SURVIVOR_RAW.map((t) =>
  standardizeTeamName(t)
);

export const BL_STYLE_SEEDS: Record<string, BlStyleSeed> = {
  "Bayern Munich": {
    summary:
      "Dominant possession, extremely high shot volume; heavy Over / BTTS / corners at home.",
    leans: ["over", "btts", "corners"],
  },
  Dortmund: {
    summary:
      "High-tempo attack, strong home record; Over / BTTS with late-goal tendency.",
    leans: ["over", "btts", "home_over"],
    notes: "Late goals after 75' are common — confidence nudge only.",
  },
  "RB Leipzig": {
    summary: "High-press, fast transitions; moderate Over, corners balanced.",
    leans: ["over", "corners"],
  },
  Leverkusen: {
    summary: "High-scoring fluid attack; strong Over and home corners.",
    leans: ["over", "corners"],
  },
  "Ein Frankfurt": {
    summary: "Physical/direct; BTTS lean and strong away corner profile.",
    leans: ["btts", "corners"],
  },
  "M'gladbach": {
    summary: "Open attacking football; high goals and corners both ways.",
    leans: ["over", "btts"],
  },
  Stuttgart: {
    summary: "High-scoring youth-driven attack; Over / BTTS / corners, strong home.",
    leans: ["over", "btts", "corners", "home_over"],
  },
  Freiburg: {
    summary: "Compact, organised, set-piece threat; Under with corner involvement.",
    leans: ["under", "corners"],
  },
  Hoffenheim: {
    summary: "High-scoring but defensively open; Over / BTTS (high variance).",
    leans: ["over", "btts"],
  },
  "Werder Bremen": {
    summary: "Direct/physical; BTTS and home corner production.",
    leans: ["btts", "corners"],
  },
  Augsburg: {
    summary: "Defensive low-block; low corner volume. Under lean.",
    leans: ["under"],
  },
  Heidenheim: {
    summary: "Compact, lower goal output; Under / low-event lean.",
    leans: ["under"],
  },
  Wolfsburg: {
    summary:
      "Established Bundesliga attack profile; Over / BTTS lean when open — qualitative only; status RECONCILE vs API.",
    leans: ["over", "btts"],
  },
  "Union Berlin": {
    summary: "Extremely compact, low-scoring; Under / low BTTS.",
    leans: ["under"],
  },
};

export function isBlPromotedHint(team: string): boolean {
  return BL_2026_27_PROMOTED_HINTS.includes(standardizeTeamName(team));
}

/** Promoted if explicit hint or not in prior-season survivor set. */
export function isBlPromotedTeam(
  team: string,
  rosterTeams?: string[] | null
): boolean {
  const name = standardizeTeamName(team);
  if (isBlPromotedHint(name)) return true;
  if (BL_PRIOR_SEASON_SURVIVORS.includes(name)) return false;
  // Unknown club on a verified roster → treat as promoted (third side / new)
  if (rosterTeams?.length) return rosterTeams.includes(name);
  return false;
}

export function blStyleSeedForTeam(team: string): BlStyleSeed | null {
  const name = standardizeTeamName(team);
  if (isBlPromotedHint(name)) return null;
  return BL_STYLE_SEEDS[name] ?? null;
}

/** Build RECONCILE mismatch rows for Wolfsburg / Heidenheim vs live API roster. */
export function blReconcileMismatches(
  apiTeams: string[]
): Array<{ provisional: string; reason: string }> {
  const set = new Set(apiTeams.map((t) => standardizeTeamName(t)));
  const out: Array<{ provisional: string; reason: string }> = [];
  for (const club of BL_2026_27_RECONCILE) {
    const inApi = set.has(club);
    const inSurvivors = BL_PRIOR_SEASON_SURVIVORS.includes(club);
    if (inSurvivors && !inApi) {
      out.push({
        provisional: club,
        reason: `RECONCILE:${club} — listed as prior survivor but missing from API roster`,
      });
    } else if (!inSurvivors && inApi) {
      out.push({
        provisional: club,
        reason: `RECONCILE:${club} — present in API but not in prior survivor set`,
      });
    } else {
      out.push({
        provisional: club,
        reason: `RECONCILE:${club} — status uncertain across sources (inApi=${inApi})`,
      });
    }
  }
  return out;
}

export function emptyBlTeamSeasonCard(
  team: string,
  opts?: { seed_paused?: boolean; is_promoted?: boolean }
): BlTeamSeasonCard {
  const name = standardizeTeamName(team);
  const is_promoted = opts?.is_promoted ?? isBlPromotedTeam(name);
  return {
    team: name,
    season: BL_SEASON_2026_27,
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
    style_seed: blStyleSeedForTeam(name),
    data_confidence: computeDataConfidence(null, is_promoted),
    seed_paused: opts?.seed_paused,
  };
}

export function emptyBlSeasonRosterStore(): BlSeasonRosterStore {
  return {
    schemaVersion: BL_SEASON_ROSTER_SCHEMA_VERSION,
    season: BL_SEASON_2026_27,
    roster_verified: false,
    teams: [],
    promoted: [...BL_2026_27_PROMOTED_HINTS],
    relegated_out: [...BL_2026_27_RELEGATED_OUT],
    mismatches: [],
    cards: {},
    updatedAt: new Date().toISOString(),
    verifyError: null,
  };
}

export function blCardKey(team: string): string {
  return standardizeTeamName(team);
}

export function getBlCardFromStore(
  store: BlSeasonRosterStore | null | undefined,
  team: string
): BlTeamSeasonCard | null {
  if (!store?.cards) return null;
  return store.cards[blCardKey(team)] ?? null;
}

export { computeDataConfidence, emptyVenueSplit, styleSeedAlign };
