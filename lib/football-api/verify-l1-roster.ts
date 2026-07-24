/**
 * Reconcile Ligue 1 2026/27 roster from API-Football /teams (league 61).
 * API-first: always overwrite store.teams with the verified normalized set when
 * a coherent ~18 list is returned. Never invent the full 18 locally.
 * Third promoted club is discovered from API (not hard-coded).
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { apiFootballGet, getApiFootballKey } from "./client";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import {
  L1_2026_27_PROMOTED_HINTS,
  L1_API_LEAGUE_ID,
  L1_API_SEASON_2026,
  L1_EXPECTED_TEAM_COUNT,
  L1_LEAGUE_NAME,
  L1_PRIOR_SEASON_SURVIVORS,
  L1_SEASON_2026_27,
  emptyL1SeasonRosterStore,
  isL1PromotedTeam,
  type L1SeasonRosterStore,
} from "@/lib/prediction-log/l1-season-roster";
import { buildAllL1SeasonCards } from "@/lib/prediction-log/l1-team-season-stats";
import { saveL1SeasonRosterStore } from "@/lib/prediction-log/l1-season-store";

interface ApiTeamRow {
  team?: { id?: number; name?: string };
}

export interface VerifyL1RosterResult {
  store: L1SeasonRosterStore;
  apiTeamCount: number;
  teams: string[];
  promoted: string[];
  overwritten: boolean;
}

function buildL1ReconcileMismatches(
  teams: string[],
  promoted: string[]
): L1SeasonRosterStore["mismatches"] {
  const mismatches: L1SeasonRosterStore["mismatches"] = [];
  for (const hint of L1_2026_27_PROMOTED_HINTS) {
    if (!teams.includes(hint)) {
      mismatches.push({
        provisional: hint,
        reason: `RECONCILE: promoted hint missing from API ${L1_LEAGUE_NAME} season ${L1_API_SEASON_2026}`,
      });
    }
  }
  const discovered = promoted.filter((t) => !L1_2026_27_PROMOTED_HINTS.includes(t));
  for (const t of discovered) {
    mismatches.push({
      provisional: t,
      reason: `RECONCILE: third/other promoted club from API (not hard-coded)`,
    });
  }
  for (const survivor of L1_PRIOR_SEASON_SURVIVORS) {
    if (!teams.includes(survivor)) {
      mismatches.push({
        provisional: survivor,
        reason: `RECONCILE: prior survivor missing from API roster`,
      });
    }
  }
  return mismatches;
}

export async function verifyL12026Roster(): Promise<VerifyL1RosterResult> {
  const base = emptyL1SeasonRosterStore();

  let apiNames: string[] = [];
  try {
    getApiFootballKey();
    const rows = await apiFootballGet<ApiTeamRow[]>("/teams", {
      league: L1_API_LEAGUE_ID,
      season: L1_API_SEASON_2026,
    });
    apiNames = (rows ?? [])
      .map((r) => r.team?.name?.trim())
      .filter((n): n is string => Boolean(n));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[verify-l1-roster] API unavailable:", msg);
    const store: L1SeasonRosterStore = {
      ...base,
      roster_verified: false,
      verifyError: msg,
      updatedAt: new Date().toISOString(),
    };
    await saveL1SeasonRosterStore(store);
    return {
      store,
      apiTeamCount: 0,
      teams: [],
      promoted: [...L1_2026_27_PROMOTED_HINTS],
      overwritten: false,
    };
  }

  const teams = [...new Set(apiNames.map((n) => standardizeTeamName(n)))].sort();
  const coherent =
    teams.length >= L1_EXPECTED_TEAM_COUNT - 1 &&
    teams.length <= L1_EXPECTED_TEAM_COUNT + 1;

  if (!coherent || teams.length === 0) {
    console.warn(
      `[verify-l1-roster] Unexpected team count ${teams.length} (expected ${L1_EXPECTED_TEAM_COUNT})`
    );
    const store: L1SeasonRosterStore = {
      ...base,
      roster_verified: false,
      teams: [],
      cards: {},
      verifyError: `API returned ${teams.length} clubs; need ~${L1_EXPECTED_TEAM_COUNT} to overwrite`,
      updatedAt: new Date().toISOString(),
    };
    await saveL1SeasonRosterStore(store);
    return {
      store,
      apiTeamCount: apiNames.length,
      teams: [],
      promoted: [...L1_2026_27_PROMOTED_HINTS],
      overwritten: false,
    };
  }

  const batches = await loadAllBatches().catch(() => []);
  const cards = buildAllL1SeasonCards(batches, undefined, teams);

  const promoted = teams.filter((t) => isL1PromotedTeam(t, teams));
  for (const team of teams) {
    if (cards[team]) {
      cards[team] = {
        ...cards[team]!,
        is_promoted: isL1PromotedTeam(team, teams),
        style_seed: cards[team]!.style_seed,
      };
    }
  }

  const mismatches = buildL1ReconcileMismatches(teams, promoted);
  for (const m of mismatches) {
    console.warn(`[verify-l1-roster] ${m.reason}:`, m.provisional);
  }

  const roster_verified = teams.length === L1_EXPECTED_TEAM_COUNT;

  const store: L1SeasonRosterStore = {
    schemaVersion: base.schemaVersion,
    season: L1_SEASON_2026_27,
    roster_verified,
    teams,
    promoted,
    relegated_out: [],
    mismatches,
    cards,
    verifyError: roster_verified
      ? null
      : `Got ${teams.length} clubs (expected ${L1_EXPECTED_TEAM_COUNT})`,
    updatedAt: new Date().toISOString(),
  };
  await saveL1SeasonRosterStore(store);

  console.warn(
    `[verify-l1-roster] Overwrote ${L1_LEAGUE_NAME} roster with ${teams.length} API clubs (verified=${roster_verified})`
  );

  return {
    store,
    apiTeamCount: apiNames.length,
    teams,
    promoted,
    overwritten: true,
  };
}
