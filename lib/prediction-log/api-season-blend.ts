/**
 * Nested API season blend — inside the outer 60% API / 40% manual rule.
 * Current season (2026/27 Match Centre) vs prior-season API rates.
 */
import { standardizeTeamName } from "@/lib/data/team-names";

export const API_CURRENT_SEASON_LABEL = "2026/27" as const;
export const API_CURRENT_SEASON_YEAR = 2026;
export const API_CURRENT_SEASON_WINDOW = {
  from: "2026-08-01",
  to: "2027-08-01",
} as const;

export const API_SEASON_BLEND = {
  current: 0.6,
  prior: 0.4,
} as const;

export const API_CURRENT_SEASON_MIN_MATCHES = 6;

export type ApiSeasonBlendMode = "60_40" | "prior_only";

export type ApiSeasonHalfRates = {
  af1: number;
  af2: number;
  da1: number;
  da2: number;
};

export type ApiSeasonBlendResult = ApiSeasonHalfRates & {
  mode: ApiSeasonBlendMode;
  nCurrent: number;
};

export function isInCurrentApiSeasonWindow(date: string): boolean {
  return (
    date >= API_CURRENT_SEASON_WINDOW.from &&
    date < API_CURRENT_SEASON_WINDOW.to
  );
}

export function hasEnoughCurrentSeasonData(nCurrent: number): boolean {
  return nCurrent >= API_CURRENT_SEASON_MIN_MATCHES;
}

function blendField(
  prior: number,
  current: number,
  wPrior: number,
  wCurrent: number
): number {
  return wPrior * prior + wCurrent * current;
}

/**
 * Blend prior and current half-rates at 60/40 when nCurrent >= threshold.
 * Missing or thin current → 100% prior (never invent).
 */
export function blendApiSeasonRates(
  prior: ApiSeasonHalfRates,
  current: ApiSeasonHalfRates | null | undefined,
  nCurrent: number
): ApiSeasonBlendResult {
  if (
    !current ||
    !hasEnoughCurrentSeasonData(nCurrent) ||
    !Number.isFinite(current.af1)
  ) {
    return {
      ...prior,
      mode: "prior_only",
      nCurrent: Math.max(0, nCurrent),
    };
  }

  const wC = API_SEASON_BLEND.current;
  const wP = API_SEASON_BLEND.prior;
  return {
    af1: blendField(prior.af1, current.af1, wP, wC),
    af2: blendField(prior.af2, current.af2, wP, wC),
    da1: blendField(prior.da1, current.da1, wP, wC),
    da2: blendField(prior.da2, current.da2, wP, wC),
    mode: "60_40",
    nCurrent,
  };
}

export function matchCentreRatesCacheKey(team: string, league: string): string {
  return `${standardizeTeamName(team).trim().toLowerCase()}|${league.trim().toLowerCase()}`;
}
