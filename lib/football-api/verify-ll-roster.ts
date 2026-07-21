/**
 * Reconcile provisional La Liga 2026/27 roster against API-Football /teams.
 * On a coherent different 20-set, overwrite store.teams (do not force provisional names).
 * Per-slot misses without full replace: seed_paused + log.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { apiFootballGet, getApiFootballKey } from "./client";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import {
  LL_2026_27_PROMOTED,
  LL_2026_27_PROVISIONAL_TEAMS,
  LL_2026_27_RELEGATED_OUT,
  LL_API_LEAGUE_ID,
  LL_API_SEASON_2026,
  LL_LEAGUE_NAME,
  LL_SEASON_2026_27,
  emptyLlSeasonRosterStore,
  isLlPromotedTeam,
  type LlSeasonRosterStore,
} from "@/lib/prediction-log/ll-season-roster";
import { buildAllLlSeasonCards } from "@/lib/prediction-log/ll-team-season-stats";
import { saveLlSeasonRosterStore } from "@/lib/prediction-log/ll-season-store";

interface ApiTeamRow {
  team?: { id?: number; name?: string };
}

function normKey(name: string): string {
  return standardizeTeamName(name)
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function matchProvisional(
  apiName: string,
  provisional: string[]
): string | null {
  const normalized = standardizeTeamName(apiName);
  if (provisional.includes(normalized)) return normalized;
  const key = normKey(normalized);
  for (const team of provisional) {
    if (normKey(team) === key) return team;
  }
  for (const team of provisional) {
    const tk = normKey(team);
    if (tk.includes(key) || key.includes(tk)) return team;
  }
  return null;
}

export interface VerifyLlRosterResult {
  store: LlSeasonRosterStore;
  apiTeamCount: number;
  matched: string[];
  unmatchedApi: string[];
  unmatchedProvisional: string[];
  overwritten: boolean;
}

export async function verifyLl2026Roster(): Promise<VerifyLlRosterResult> {
  const base = emptyLlSeasonRosterStore();
  const provisional = [...LL_2026_27_PROVISIONAL_TEAMS];

  let apiNames: string[] = [];
  try {
    getApiFootballKey();
    const rows = await apiFootballGet<ApiTeamRow[]>("/teams", {
      league: LL_API_LEAGUE_ID,
      season: LL_API_SEASON_2026,
    });
    apiNames = (rows ?? [])
      .map((r) => r.team?.name?.trim())
      .filter((n): n is string => Boolean(n));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[verify-ll-roster] API unavailable:", msg);
    const batches = await loadAllBatches().catch(() => []);
    const cards = buildAllLlSeasonCards(batches);
    const store: LlSeasonRosterStore = {
      ...base,
      roster_verified: false,
      cards,
      verifyError: msg,
      updatedAt: new Date().toISOString(),
    };
    await saveLlSeasonRosterStore(store);
    return {
      store,
      apiTeamCount: 0,
      matched: [],
      unmatchedApi: [],
      unmatchedProvisional: provisional,
      overwritten: false,
    };
  }

  const matched = new Set<string>();
  const unmatchedApi: string[] = [];
  const normalizedApi: string[] = [];

  for (const apiName of apiNames) {
    const hit = matchProvisional(apiName, provisional);
    const normalized = standardizeTeamName(apiName);
    if (hit) {
      matched.add(hit);
      normalizedApi.push(hit);
    } else {
      unmatchedApi.push(apiName);
      normalizedApi.push(normalized);
      console.warn(
        `[verify-ll-roster] API team not in provisional ${LL_SEASON_2026_27} roster:`,
        apiName
      );
    }
  }

  const unmatchedProvisional = provisional.filter((t) => !matched.has(t));
  const uniqueApiTeams = [...new Set(normalizedApi)];
  const coherentOverwrite =
    uniqueApiTeams.length >= 18 && uniqueApiTeams.length <= 22;

  let teams = provisional;
  let overwritten = false;
  const mismatches: LlSeasonRosterStore["mismatches"] = [];
  const paused = new Set<string>();

  if (coherentOverwrite && unmatchedApi.length > 0) {
    // Brief: overwrite list when live set differs — do not force provisional names
    teams = uniqueApiTeams;
    overwritten = true;
    console.warn(
      `[verify-ll-roster] Overwriting provisional roster with ${teams.length} API clubs`
    );
  } else {
    for (const name of unmatchedProvisional) {
      mismatches.push({
        provisional: name,
        reason: `Not found in API-Football ${LL_LEAGUE_NAME} season ${LL_API_SEASON_2026} teams list`,
      });
      paused.add(name);
      console.warn(`[verify-ll-roster] Provisional slot paused:`, name);
    }
  }

  const batches = await loadAllBatches().catch(() => []);
  const cards = buildAllLlSeasonCards(batches, paused, teams);

  // Re-tag promoted on overwritten set using known promoted names
  for (const team of teams) {
    if (cards[team] && isLlPromotedTeam(team)) {
      cards[team] = { ...cards[team]!, is_promoted: true };
    }
  }

  const roster_verified =
    overwritten
      ? uniqueApiTeams.length === 20
      : unmatchedProvisional.length === 0 &&
        apiNames.length >= 18 &&
        matched.size === provisional.length;

  const store: LlSeasonRosterStore = {
    schemaVersion: base.schemaVersion,
    season: LL_SEASON_2026_27,
    roster_verified,
    teams,
    promoted: LL_2026_27_PROMOTED.filter((t) => teams.includes(t)),
    relegated_out: [...LL_2026_27_RELEGATED_OUT],
    mismatches,
    cards,
    verifyError: null,
    updatedAt: new Date().toISOString(),
  };
  await saveLlSeasonRosterStore(store);

  return {
    store,
    apiTeamCount: apiNames.length,
    matched: [...matched],
    unmatchedApi,
    unmatchedProvisional,
    overwritten,
  };
}
