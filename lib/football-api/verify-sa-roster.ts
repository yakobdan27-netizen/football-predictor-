/**
 * Reconcile provisional Serie A 2026/27 roster against API-Football /teams.
 * On a coherent different 20-set, overwrite store.teams (do not force provisional names).
 * Per-slot misses without full replace: seed_paused + log.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { apiFootballGet, getApiFootballKey } from "./client";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import {
  SA_2026_27_PROMOTED,
  SA_2026_27_PROVISIONAL_TEAMS,
  SA_2026_27_RELEGATED_OUT,
  SA_API_LEAGUE_ID,
  SA_API_SEASON_2026,
  SA_LEAGUE_NAME,
  SA_SEASON_2026_27,
  emptySaSeasonRosterStore,
  isSaPromotedTeam,
  type SaSeasonRosterStore,
} from "@/lib/prediction-log/sa-season-roster";
import { buildAllSaSeasonCards } from "@/lib/prediction-log/sa-team-season-stats";
import { saveSaSeasonRosterStore } from "@/lib/prediction-log/sa-season-store";

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

export interface VerifySaRosterResult {
  store: SaSeasonRosterStore;
  apiTeamCount: number;
  matched: string[];
  unmatchedApi: string[];
  unmatchedProvisional: string[];
  overwritten: boolean;
}

export async function verifySa2026Roster(): Promise<VerifySaRosterResult> {
  const base = emptySaSeasonRosterStore();
  const provisional = [...SA_2026_27_PROVISIONAL_TEAMS];

  let apiNames: string[] = [];
  try {
    getApiFootballKey();
    const rows = await apiFootballGet<ApiTeamRow[]>("/teams", {
      league: SA_API_LEAGUE_ID,
      season: SA_API_SEASON_2026,
    });
    apiNames = (rows ?? [])
      .map((r) => r.team?.name?.trim())
      .filter((n): n is string => Boolean(n));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[verify-sa-roster] API unavailable:", msg);
    const batches = await loadAllBatches().catch(() => []);
    const cards = buildAllSaSeasonCards(batches);
    const store: SaSeasonRosterStore = {
      ...base,
      roster_verified: false,
      cards,
      verifyError: msg,
      updatedAt: new Date().toISOString(),
    };
    await saveSaSeasonRosterStore(store);
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
        `[verify-sa-roster] API team not in provisional ${SA_SEASON_2026_27} roster:`,
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
  const mismatches: SaSeasonRosterStore["mismatches"] = [];
  const paused = new Set<string>();

  if (coherentOverwrite && unmatchedApi.length > 0) {
    // Brief: overwrite list when live set differs — do not force provisional names
    teams = uniqueApiTeams;
    overwritten = true;
    console.warn(
      `[verify-sa-roster] Overwriting provisional roster with ${teams.length} API clubs`
    );
  } else {
    for (const name of unmatchedProvisional) {
      mismatches.push({
        provisional: name,
        reason: `Not found in API-Football ${SA_LEAGUE_NAME} season ${SA_API_SEASON_2026} teams list`,
      });
      paused.add(name);
      console.warn(`[verify-sa-roster] Provisional slot paused:`, name);
    }
  }

  const batches = await loadAllBatches().catch(() => []);
  const cards = buildAllSaSeasonCards(batches, paused, teams);

  // Re-tag promoted on overwritten set using known promoted names
  for (const team of teams) {
    if (cards[team] && isSaPromotedTeam(team)) {
      cards[team] = { ...cards[team]!, is_promoted: true };
    }
  }

  const roster_verified =
    overwritten
      ? uniqueApiTeams.length === 20
      : unmatchedProvisional.length === 0 &&
        apiNames.length >= 18 &&
        matched.size === provisional.length;

  const store: SaSeasonRosterStore = {
    schemaVersion: base.schemaVersion,
    season: SA_SEASON_2026_27,
    roster_verified,
    teams,
    promoted: SA_2026_27_PROMOTED.filter((t) => teams.includes(t)),
    relegated_out: [...SA_2026_27_RELEGATED_OUT],
    mismatches,
    cards,
    verifyError: null,
    updatedAt: new Date().toISOString(),
  };
  await saveSaSeasonRosterStore(store);

  return {
    store,
    apiTeamCount: apiNames.length,
    matched: [...matched],
    unmatchedApi,
    unmatchedProvisional,
    overwritten,
  };
}
