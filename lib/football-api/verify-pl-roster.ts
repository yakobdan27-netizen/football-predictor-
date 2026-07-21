/**
 * Reconcile provisional PL 2026/27 roster against API-Football /teams.
 * Never invents replacements for mismatches — marks seed_paused and logs.
 */
import { standardizeTeamName } from "@/lib/data/team-names";
import { apiFootballGet, getApiFootballKey } from "./client";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import {
  PL_2026_27_PROVISIONAL_TEAMS,
  PL_API_SEASON_2026,
  PL_LEAGUE_NAME,
  PL_SEASON_2026_27,
  emptyPlSeasonRosterStore,
  type PlSeasonRosterStore,
} from "@/lib/prediction-log/pl-season-roster";
import { buildAllPlSeasonCards } from "@/lib/prediction-log/pl-team-season-stats";
import { savePlSeasonRosterStore } from "@/lib/prediction-log/pl-season-store";

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

export interface VerifyPlRosterResult {
  store: PlSeasonRosterStore;
  apiTeamCount: number;
  matched: string[];
  unmatchedApi: string[];
  unmatchedProvisional: string[];
}

/**
 * Fetch official 2026/27 PL clubs and reconcile with provisional roster.
 */
export async function verifyPl2026Roster(): Promise<VerifyPlRosterResult> {
  const base = emptyPlSeasonRosterStore();
  const provisional = [...PL_2026_27_PROVISIONAL_TEAMS];

  let apiNames: string[] = [];
  try {
    getApiFootballKey();
    const rows = await apiFootballGet<ApiTeamRow[]>("/teams", {
      league: 39,
      season: PL_API_SEASON_2026,
    });
    apiNames = (rows ?? [])
      .map((r) => r.team?.name?.trim())
      .filter((n): n is string => Boolean(n));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[verify-pl-roster] API unavailable:", msg);
    const batches = await loadAllBatches().catch(() => []);
    const cards = buildAllPlSeasonCards(batches);
    const store: PlSeasonRosterStore = {
      ...base,
      roster_verified: false,
      cards,
      verifyError: msg,
      updatedAt: new Date().toISOString(),
    };
    await savePlSeasonRosterStore(store);
    return {
      store,
      apiTeamCount: 0,
      matched: [],
      unmatchedApi: [],
      unmatchedProvisional: provisional,
    };
  }

  const matched = new Set<string>();
  const unmatchedApi: string[] = [];
  const mismatches: PlSeasonRosterStore["mismatches"] = [];

  for (const apiName of apiNames) {
    const hit = matchProvisional(apiName, provisional);
    if (hit) {
      matched.add(hit);
    } else {
      unmatchedApi.push(apiName);
      console.warn(
        `[verify-pl-roster] API team not in provisional ${PL_SEASON_2026_27} roster:`,
        apiName
      );
    }
  }

  const unmatchedProvisional = provisional.filter((t) => !matched.has(t));
  for (const name of unmatchedProvisional) {
    mismatches.push({
      provisional: name,
      reason: `Not found in API-Football ${PL_LEAGUE_NAME} season ${PL_API_SEASON_2026} teams list`,
    });
    console.warn(
      `[verify-pl-roster] Provisional slot paused (no API match):`,
      name
    );
  }

  const paused = new Set(unmatchedProvisional);
  const batches = await loadAllBatches().catch(() => []);
  const cards = buildAllPlSeasonCards(batches, paused);

  const roster_verified =
    unmatchedProvisional.length === 0 &&
    apiNames.length >= 18 &&
    matched.size === provisional.length;

  const store: PlSeasonRosterStore = {
    ...base,
    roster_verified,
    mismatches,
    cards,
    verifyError: null,
    updatedAt: new Date().toISOString(),
  };
  await savePlSeasonRosterStore(store);

  return {
    store,
    apiTeamCount: apiNames.length,
    matched: [...matched],
    unmatchedApi,
    unmatchedProvisional,
  };
}
