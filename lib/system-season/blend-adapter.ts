/**
 * Adapters: system_season team rates → CFE / matchup λ inputs (40% blend side).
 */
import { apiLeagueId } from "@/lib/football-api/leagues";
import { computeAttackDefenceStageA } from "@/lib/prediction-log/hsh-model";
import { loadLeagueAfBaselines } from "@/lib/prediction-log/hsh-half-rates";
import type { ClubHalfAttackDefence } from "@/lib/prediction-log/hsh-half-rates";
import { clampLambda } from "@/lib/prediction-log/model-config";
import type { SystemSeasonRatesSnapshot } from "./team-rates";

export function snapshotToClubRates(
  snap: SystemSeasonRatesSnapshot,
  league: string
): ClubHalfAttackDefence {
  return {
    clubName: snap.teamName,
    league,
    af1: snap.af1,
    af2: snap.af2,
    da1: snap.da1,
    da2: snap.da2,
    nMatches: snap.nMatches,
    seasonCount: 1,
    seedOnly: false,
    sourceNote: `system-season n=${snap.nMatches}`,
  };
}

export function lambdasFromSystemSeasonSnapshots(
  home: SystemSeasonRatesSnapshot | null | undefined,
  away: SystemSeasonRatesSnapshot | null | undefined,
  league: string
): { lambdaHome: number | null; lambdaAway: number | null } {
  if (!home || !away) return { lambdaHome: null, lambdaAway: null };
  const { lgAf1, lgAf2 } = loadLeagueAfBaselines(league);
  const stageA = computeAttackDefenceStageA({
    home: snapshotToClubRates(home, league),
    away: snapshotToClubRates(away, league),
    lgAf1,
    lgAf2,
  });
  return {
    lambdaHome: clampLambda(stageA.lambdaA1 + stageA.lambdaA2, "λ_home_sys"),
    lambdaAway: clampLambda(stageA.lambdaB1 + stageA.lambdaB2, "λ_away_sys"),
  };
}

export async function systemSeasonMatchupLambdas(
  homeTeam: string,
  awayTeam: string,
  league: string,
  cache?: Map<string, SystemSeasonRatesSnapshot>
): Promise<{ lambdaHome: number; lambdaAway: number; source: string } | null> {
  const leagueId = apiLeagueId(league);
  if (leagueId == null) return null;

  let homeSnap = cache?.get(`${homeTeam}|${league}`);
  let awaySnap = cache?.get(`${awayTeam}|${league}`);

  if (!homeSnap || !awaySnap) {
    const { getTeamRatesByName } = await import("./store");
    const { snapshotFromTeamRate, systemSeasonRatesCacheKey } = await import(
      "./team-rates"
    );
    if (!homeSnap) {
      const row = await getTeamRatesByName(homeTeam, leagueId);
      homeSnap = row ? snapshotFromTeamRate(row) ?? undefined : undefined;
      if (homeSnap && cache) {
        cache.set(systemSeasonRatesCacheKey(homeTeam, league), homeSnap);
      }
    }
    if (!awaySnap) {
      const row = await getTeamRatesByName(awayTeam, leagueId);
      awaySnap = row ? snapshotFromTeamRate(row) ?? undefined : undefined;
      if (awaySnap && cache) {
        cache.set(systemSeasonRatesCacheKey(awayTeam, league), awaySnap);
      }
    }
  }

  const lambdas = lambdasFromSystemSeasonSnapshots(homeSnap, awaySnap, league);
  if (lambdas.lambdaHome == null || lambdas.lambdaAway == null) return null;
  return {
    lambdaHome: lambdas.lambdaHome,
    lambdaAway: lambdas.lambdaAway,
    source: `system-season 2026/27 (n=${homeSnap?.nMatches ?? 0}/${awaySnap?.nMatches ?? 0})`,
  };
}
