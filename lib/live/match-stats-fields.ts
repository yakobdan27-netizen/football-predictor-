import type { MatchStats } from "@/lib/db/schema";
import type { LiveBeSoccerEnrichment } from "@/lib/live/types";

/** Flattened nullable stats used in API / UI responses. */
export type MatchStatsFields = {
  homeCorners: number | null;
  awayCorners: number | null;
  homeShots: number | null;
  awayShots: number | null;
  homePossession: number | null;
  awayPossession: number | null;
  homeShotsOnTarget: number | null;
  awayShotsOnTarget: number | null;
  homeXg: number | null;
  awayXg: number | null;
  homeBigChances: number | null;
  awayBigChances: number | null;
  homeGkSaves: number | null;
  awayGkSaves: number | null;
  homeFouls: number | null;
  awayFouls: number | null;
  homeYellowCards: number | null;
  awayYellowCards: number | null;
  homeRedCards: number | null;
  awayRedCards: number | null;
  homePasses: number | null;
  awayPasses: number | null;
  homeAccuratePasses: number | null;
  awayAccuratePasses: number | null;
  homeTackles: number | null;
  awayTackles: number | null;
  homeFreeKicks: number | null;
  awayFreeKicks: number | null;
};

export function matchStatsFieldsFromRow(
  row: Partial<MatchStats> | LiveBeSoccerEnrichment | null | undefined
): MatchStatsFields {
  return {
    homeCorners: row?.homeCorners ?? null,
    awayCorners: row?.awayCorners ?? null,
    homeShots: row?.homeShots ?? null,
    awayShots: row?.awayShots ?? null,
    homePossession: row?.homePossession ?? null,
    awayPossession: row?.awayPossession ?? null,
    homeShotsOnTarget: row?.homeShotsOnTarget ?? null,
    awayShotsOnTarget: row?.awayShotsOnTarget ?? null,
    homeXg: row?.homeXg ?? null,
    awayXg: row?.awayXg ?? null,
    homeBigChances: row?.homeBigChances ?? null,
    awayBigChances: row?.awayBigChances ?? null,
    homeGkSaves: row?.homeGkSaves ?? null,
    awayGkSaves: row?.awayGkSaves ?? null,
    homeFouls: row?.homeFouls ?? null,
    awayFouls: row?.awayFouls ?? null,
    homeYellowCards: row?.homeYellowCards ?? null,
    awayYellowCards: row?.awayYellowCards ?? null,
    homeRedCards: row?.homeRedCards ?? null,
    awayRedCards: row?.awayRedCards ?? null,
    homePasses: row?.homePasses ?? null,
    awayPasses: row?.awayPasses ?? null,
    homeAccuratePasses: row?.homeAccuratePasses ?? null,
    awayAccuratePasses: row?.awayAccuratePasses ?? null,
    homeTackles: row?.homeTackles ?? null,
    awayTackles: row?.awayTackles ?? null,
    homeFreeKicks: row?.homeFreeKicks ?? null,
    awayFreeKicks: row?.awayFreeKicks ?? null,
  };
}

export function hasNumericMatchStats(fields: MatchStatsFields): boolean {
  return Object.values(fields).some((v) => v != null);
}
