/**
 * Men's top-flight API-Football fixture eligibility.
 * Filters youth/women/friendlies/cups and requires both clubs in the league season roster.
 *
 * Note: cannot fix wrong kickoff dates if the provider publishes a draft schedule.
 */
import { ensureTeamIdMap } from "./team-id-map";

export type EligibleFixtureShape = {
  fixture?: { id?: number; date?: string; status?: { short?: string | null } };
  league?: {
    id?: number;
    name?: string;
    type?: string;
    round?: string;
    season?: number;
  };
  teams: {
    home: { id?: number | null; name: string };
    away: { id?: number | null; name: string };
  };
};

export type FixtureEligibilityContext = {
  expectedLeagueId: number;
  season: number;
  allowedTeamIds: Set<number>;
};

export type FixtureDropReason =
  | "wrong_league"
  | "not_league_type"
  | "non_regular_round"
  | "youth_or_women_team"
  | "team_not_in_roster";

export type FilterEligibleFixturesResult<T extends EligibleFixtureShape> = {
  kept: T[];
  dropped: number;
  reasonsByCode: Partial<Record<FixtureDropReason, number>>;
};

const YOUTH_WOMEN_NAME =
  /\b(women|w\b|u19|u21|u23|u18|reserve|youth)\b|(?:\s|^)(ii|b)\b/i;

const NON_REGULAR_ROUND =
  /\b(friendl\w*|qualification|promotion|relegation|play[- ]?offs?|pre[- ]?season|super cup|community shield)\b/i;

export function isYouthOrWomenTeamName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  return YOUTH_WOMEN_NAME.test(n);
}

/** Allow regular league rounds; reject friendlies / cups / playoffs when round is present. */
export function isRegularLeagueRound(round: string | undefined | null): boolean {
  if (round == null || round.trim() === "") return true;
  const r = round.trim();
  if (NON_REGULAR_ROUND.test(r)) return false;
  if (/regular season|matchday|jornada|spieltag|giornata|round\s+\d/i.test(r)) {
    return true;
  }
  // Lenient: unknown round labels pass if not explicitly blocked
  return true;
}

export function getFixtureDropReason(
  f: EligibleFixtureShape,
  ctx: FixtureEligibilityContext
): FixtureDropReason | null {
  const leagueId = f.league?.id;
  if (leagueId != null && leagueId !== ctx.expectedLeagueId) {
    return "wrong_league";
  }

  const leagueType = f.league?.type?.trim();
  if (leagueType && leagueType.toLowerCase() !== "league") {
    return "not_league_type";
  }

  const round = f.league?.round;
  if (round != null && round !== "" && !isRegularLeagueRound(round)) {
    return "non_regular_round";
  }

  const homeName = f.teams.home.name?.trim() ?? "";
  const awayName = f.teams.away.name?.trim() ?? "";
  if (isYouthOrWomenTeamName(homeName) || isYouthOrWomenTeamName(awayName)) {
    return "youth_or_women_team";
  }

  const homeId = f.teams.home.id;
  const awayId = f.teams.away.id;
  if (
    homeId == null ||
    awayId == null ||
    !ctx.allowedTeamIds.has(homeId) ||
    !ctx.allowedTeamIds.has(awayId)
  ) {
    return "team_not_in_roster";
  }

  return null;
}

export function isMensTopFlightFixture(
  f: EligibleFixtureShape,
  ctx: FixtureEligibilityContext
): boolean {
  return getFixtureDropReason(f, ctx) == null;
}

export function filterEligibleFixtures<T extends EligibleFixtureShape>(
  fixtures: T[],
  ctx: FixtureEligibilityContext
): FilterEligibleFixturesResult<T> {
  const kept: T[] = [];
  const reasonsByCode: Partial<Record<FixtureDropReason, number>> = {};

  for (const f of fixtures) {
    const reason = getFixtureDropReason(f, ctx);
    if (reason == null) {
      kept.push(f);
    } else {
      reasonsByCode[reason] = (reasonsByCode[reason] ?? 0) + 1;
    }
  }

  return {
    kept,
    dropped: fixtures.length - kept.length,
    reasonsByCode,
  };
}

export async function loadAllowedTeamIds(
  leagueId: number,
  season: number
): Promise<Set<number>> {
  const map = await ensureTeamIdMap(leagueId, season);
  return new Set(Object.values(map.byName));
}

export async function buildFixtureEligibilityContext(
  leagueId: number,
  season: number
): Promise<FixtureEligibilityContext> {
  return {
    expectedLeagueId: leagueId,
    season,
    allowedTeamIds: await loadAllowedTeamIds(leagueId, season),
  };
}

export function sumFilterReasons(
  reasons: Partial<Record<FixtureDropReason, number>>[]
): Partial<Record<FixtureDropReason, number>> {
  const out: Partial<Record<FixtureDropReason, number>> = {};
  for (const r of reasons) {
    for (const [code, count] of Object.entries(r)) {
      const k = code as FixtureDropReason;
      out[k] = (out[k] ?? 0) + (count ?? 0);
    }
  }
  return out;
}
