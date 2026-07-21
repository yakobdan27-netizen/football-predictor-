/**
 * Reconcile Bundesliga 2026/27 roster from API-Football /teams (league 78).
 * API-first: always overwrite store.teams with the verified normalized set when
 * a coherent ~18 list is returned. Never invent the full 18 locally.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { apiFootballGet, getApiFootballKey } from "./client";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import {
  BL_2026_27_PROMOTED_HINTS,
  BL_2026_27_RELEGATED_OUT,
  BL_API_LEAGUE_ID,
  BL_API_SEASON_2026,
  BL_EXPECTED_TEAM_COUNT,
  BL_LEAGUE_NAME,
  BL_SEASON_2026_27,
  emptyBlSeasonRosterStore,
  isBlPromotedTeam,
  type BlSeasonRosterStore,
} from "@/lib/prediction-log/bl-season-roster";
import { buildAllBlSeasonCards } from "@/lib/prediction-log/bl-team-season-stats";
import { saveBlSeasonRosterStore } from "@/lib/prediction-log/bl-season-store";

interface ApiTeamRow {
  team?: { id?: number; name?: string };
}

export interface VerifyBlRosterResult {
  store: BlSeasonRosterStore;
  apiTeamCount: number;
  teams: string[];
  promoted: string[];
  overwritten: boolean;
}

export async function verifyBl2026Roster(): Promise<VerifyBlRosterResult> {
  const base = emptyBlSeasonRosterStore();

  let apiNames: string[] = [];
  try {
    getApiFootballKey();
    const rows = await apiFootballGet<ApiTeamRow[]>("/teams", {
      league: BL_API_LEAGUE_ID,
      season: BL_API_SEASON_2026,
    });
    apiNames = (rows ?? [])
      .map((r) => r.team?.name?.trim())
      .filter((n): n is string => Boolean(n));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[verify-bl-roster] API unavailable:", msg);
    const store: BlSeasonRosterStore = {
      ...base,
      roster_verified: false,
      verifyError: msg,
      updatedAt: new Date().toISOString(),
    };
    await saveBlSeasonRosterStore(store);
    return {
      store,
      apiTeamCount: 0,
      teams: [],
      promoted: [...BL_2026_27_PROMOTED_HINTS],
      overwritten: false,
    };
  }

  const teams = [...new Set(apiNames.map((n) => standardizeTeamName(n)))].sort();
  const coherent =
    teams.length >= BL_EXPECTED_TEAM_COUNT - 1 &&
    teams.length <= BL_EXPECTED_TEAM_COUNT + 1;

  if (!coherent || teams.length === 0) {
    console.warn(
      `[verify-bl-roster] Unexpected team count ${teams.length} (expected ${BL_EXPECTED_TEAM_COUNT})`
    );
    const store: BlSeasonRosterStore = {
      ...base,
      roster_verified: false,
      teams: [],
      cards: {},
      verifyError: `API returned ${teams.length} clubs; need ~${BL_EXPECTED_TEAM_COUNT} to overwrite`,
      updatedAt: new Date().toISOString(),
    };
    await saveBlSeasonRosterStore(store);
    return {
      store,
      apiTeamCount: apiNames.length,
      teams: [],
      promoted: [...BL_2026_27_PROMOTED_HINTS],
      overwritten: false,
    };
  }

  const batches = await loadAllBatches().catch(() => []);
  const cards = buildAllBlSeasonCards(batches, undefined, teams);

  const promoted = teams.filter((t) => isBlPromotedTeam(t, teams));
  for (const team of teams) {
    if (cards[team]) {
      cards[team] = {
        ...cards[team]!,
        is_promoted: isBlPromotedTeam(team, teams),
        style_seed: cards[team]!.style_seed,
      };
    }
  }

  const roster_verified = teams.length === BL_EXPECTED_TEAM_COUNT;

  const store: BlSeasonRosterStore = {
    schemaVersion: base.schemaVersion,
    season: BL_SEASON_2026_27,
    roster_verified,
    teams,
    promoted,
    relegated_out: [...BL_2026_27_RELEGATED_OUT],
    mismatches: [],
    cards,
    verifyError: roster_verified
      ? null
      : `Got ${teams.length} clubs (expected ${BL_EXPECTED_TEAM_COUNT})`,
    updatedAt: new Date().toISOString(),
  };
  await saveBlSeasonRosterStore(store);

  console.warn(
    `[verify-bl-roster] Overwrote ${BL_LEAGUE_NAME} roster with ${teams.length} API clubs (verified=${roster_verified})`
  );

  return {
    store,
    apiTeamCount: apiNames.length,
    teams,
    promoted,
    overwritten: true,
  };
}
