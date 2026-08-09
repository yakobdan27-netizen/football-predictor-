/**
 * Half-share / κ types + in-memory cache (safe for client bundles).
 * DB load/save lives in half-params.ts (server-only).
 */
import { CORNER_DISPERSION_NB_THRESHOLD } from "@/lib/prediction-log/model-config";

/** Brief §2.2 — competitions below this show INSUFFICIENT HALF-TIME DATA. */
export const DIEH_MIN_VALID_FIXTURES = 200;

/** Brief §3.2 — shrinkage pseudo-count toward independence (κ → 1). */
export const KAPPA_SHRINKAGE_M = 300;

/** Per-side goal sample below this falls back to combined competition share. */
export const HALF_SHARE_SIDE_MIN_SAMPLE = 100;

export type GoalsDistChoice = "poisson" | "negbin";

export type LeagueHalfParams = {
  leagueId: number;
  compType: "league" | "cup";
  leagueName: string;
  s1: number;
  s1Home: number;
  s1Away: number;
  usedCombinedShareHome: boolean;
  usedCombinedShareAway: boolean;
  nValid: number;
  nHomeGoalsSample: number;
  nAwayGoalsSample: number;
  kappaRaw: number;
  kappaAdj: number;
  pD1Obs: number;
  pD2Obs: number;
  pD1d2Obs: number;
  goalsMean: number | null;
  goalsVariance: number | null;
  goalsDispersion: number | null;
  goalsDistribution: GoalsDistChoice;
  computedAt: string;
};

export type HalfParamsStore = {
  fittedAt: string;
  leagues: LeagueHalfParams[];
};

let cachedStore: HalfParamsStore | null = null;

export function setCachedHalfParams(store: HalfParamsStore | null): void {
  cachedStore = store;
}

export function getCachedHalfParams(): HalfParamsStore | null {
  return cachedStore;
}

export function emptyHalfParamsStore(): HalfParamsStore {
  return { fittedAt: new Date(0).toISOString(), leagues: [] };
}

export function chooseGoalsDistribution(dispersion: number): GoalsDistChoice {
  return dispersion > CORNER_DISPERSION_NB_THRESHOLD ? "negbin" : "poisson";
}

export function halfParamsKey(leagueId: number, compType: string): string {
  return `${leagueId}:${compType}`;
}

export function lookupHalfParams(
  store: HalfParamsStore | null | undefined,
  leagueId: number | null,
  compType: "league" | "cup" = "league"
): LeagueHalfParams | null {
  if (!store || leagueId == null) return null;
  return (
    store.leagues.find(
      (r) => r.leagueId === leagueId && r.compType === compType
    ) ?? null
  );
}

/** True when computed_at is older than `maxAgeMs` or store is empty. */
export function halfParamsAreStale(
  store: HalfParamsStore | null,
  maxAgeMs: number
): boolean {
  if (!store || store.leagues.length === 0) return true;
  const t = Date.parse(store.fittedAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > maxAgeMs;
}

/** Sync lookup using in-memory cache only (client CFE path). */
export function lookupCachedHalfParams(
  leagueId: number | null,
  compType: "league" | "cup" = "league"
): LeagueHalfParams | null {
  return lookupHalfParams(cachedStore, leagueId, compType);
}
