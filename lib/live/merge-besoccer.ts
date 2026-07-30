import type {
  LiveSourceConflict,
  StatsApiMatch,
} from "@/lib/stats-api/types";
import { emptyMergedMatchStats } from "@/lib/stats-api/types";
import type { LiveApiFixture, LiveBeSoccerEnrichment } from "./types";

function mergeScalar(
  field: string,
  apiVal: number | null,
  secondaryVal: number | null,
  conflicts: LiveSourceConflict[]
): number | null {
  if (apiVal == null && secondaryVal == null) return null;
  if (apiVal == null) return secondaryVal;
  if (secondaryVal == null) return apiVal;
  if (apiVal === secondaryVal) return apiVal;
  conflicts.push({ field, apiFootball: apiVal, beSoccer: secondaryVal });
  return apiVal;
}

/**
 * Merge API-Football fixture with optional Stats API match stats.
 * On overlapping numeric disagreements, keep AF display value and record conflict.
 */
export function mergeLiveSources(
  apiFootball: LiveApiFixture,
  secondary: StatsApiMatch | null,
  statsApiMatchId?: string | null
): {
  fixture: LiveApiFixture;
  enrichment: LiveBeSoccerEnrichment;
} {
  const conflicts: LiveSourceConflict[] = [];

  if (!secondary) {
    return {
      fixture: apiFootball,
      enrichment: {
        besoccerMatchId: statsApiMatchId ?? null,
        ...emptyMergedMatchStats(),
        sourceConflicts: [],
      },
    };
  }

  const homeGoals = mergeScalar(
    "homeGoals",
    apiFootball.goals?.home ?? null,
    secondary.homeGoals,
    conflicts
  );
  const awayGoals = mergeScalar(
    "awayGoals",
    apiFootball.goals?.away ?? null,
    secondary.awayGoals,
    conflicts
  );

  const fixture: LiveApiFixture = {
    ...apiFootball,
    goals: { home: homeGoals, away: awayGoals },
  };

  const afElapsed = apiFootball.fixture?.status?.elapsed ?? null;
  if (
    (afElapsed == null || !Number.isFinite(afElapsed)) &&
    secondary.minute != null
  ) {
    fixture.fixture = {
      ...fixture.fixture,
      status: {
        ...fixture.fixture.status,
        elapsed: secondary.minute,
      },
    };
  }

  return {
    fixture,
    enrichment: {
      besoccerMatchId: statsApiMatchId ?? secondary.id,
      homeCorners: secondary.homeCorners,
      awayCorners: secondary.awayCorners,
      homeShots: secondary.homeShots,
      awayShots: secondary.awayShots,
      homePossession: secondary.homePossession,
      awayPossession: secondary.awayPossession,
      homeShotsOnTarget: secondary.homeShotsOnTarget,
      awayShotsOnTarget: secondary.awayShotsOnTarget,
      homeXg: secondary.homeXg,
      awayXg: secondary.awayXg,
      homeBigChances: secondary.homeBigChances,
      awayBigChances: secondary.awayBigChances,
      homeGkSaves: secondary.homeGkSaves,
      awayGkSaves: secondary.awayGkSaves,
      homeFouls: secondary.homeFouls,
      awayFouls: secondary.awayFouls,
      homeYellowCards: secondary.homeYellowCards,
      awayYellowCards: secondary.awayYellowCards,
      homeRedCards: secondary.homeRedCards,
      awayRedCards: secondary.awayRedCards,
      homePasses: secondary.homePasses,
      awayPasses: secondary.awayPasses,
      homeAccuratePasses: secondary.homeAccuratePasses,
      awayAccuratePasses: secondary.awayAccuratePasses,
      homeTackles: secondary.homeTackles,
      awayTackles: secondary.awayTackles,
      homeFreeKicks: secondary.homeFreeKicks,
      awayFreeKicks: secondary.awayFreeKicks,
      rawJson: secondary.rawJson,
      sourceConflicts: conflicts,
    },
  };
}
