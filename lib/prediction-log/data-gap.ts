/**
 * Manual-first data-gap detection for 2H / reco / combo.
 * Never invents numbers — only flags when stored history is thin or null.
 */
import { MIN_MATCHES } from "./two-h-heavy/config";
import type { TeamHalfProfile } from "./two-h-heavy/types";

export { MIN_MATCHES };

export function hasNullHalfFields(
  profile: Pick<
    TeamHalfProfile,
    "sc_1h" | "sc_2h" | "conc_1h" | "conc_2h"
  > | null | undefined
): boolean {
  if (!profile) return true;
  const vals = [profile.sc_1h, profile.sc_2h, profile.conc_1h, profile.conc_2h];
  return vals.some((v) => v == null || !Number.isFinite(v));
}

/** True when a single side lacks enough stored matches or required fields. */
export function isTeamHalfDataGap(
  profile: Pick<
    TeamHalfProfile,
    "n_matches" | "sc_1h" | "sc_2h" | "conc_1h" | "conc_2h"
  > | null | undefined,
  minMatches: number = MIN_MATCHES
): boolean {
  if (!profile) return true;
  if (profile.n_matches < minMatches) return true;
  return hasNullHalfFields(profile);
}

/** Match-level gap when either side is thin/null. */
export function isMatchHalfDataGap(
  home: Parameters<typeof isTeamHalfDataGap>[0],
  away: Parameters<typeof isTeamHalfDataGap>[0],
  minMatches: number = MIN_MATCHES
): boolean {
  return isTeamHalfDataGap(home, minMatches) || isTeamHalfDataGap(away, minMatches);
}

/** Master-prob / club path: zero usable signal reliability. */
export function isSignalReliabilityGap(totalReliability: number): boolean {
  return !(totalReliability > 0);
}

export function partlyFromApiSources(
  homeSource: string | undefined,
  awaySource: string | undefined
): boolean {
  return homeSource === "api" || awaySource === "api";
}
