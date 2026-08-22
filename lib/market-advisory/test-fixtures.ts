import { canonicalFixtureEstimateSync } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { PredictionBatch } from "@/lib/prediction-log/types";

const EMPTY_BATCHES: PredictionBatch[] = [];

const STUB_RATES = {
  clubName: "Stub",
  league: "Premier League",
  af1: 1.1,
  af2: 1.0,
  da1: 1.0,
  da2: 1.0,
  nMatches: 20,
  seasonCount: 3,
  seedOnly: false,
  sourceNote: null,
  apiSeasonCurrentN: 10,
  apiSeasonBlend: "60_40" as const,
};

export function minimalCfe(): CanonicalFixtureEstimate {
  return canonicalFixtureEstimateSync(
    {
      matchId: "test-match",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      league: "Premier League",
      batches: EMPTY_BATCHES,
      hshCtx: {
        matchId: "test-match",
        homeTeam: "Arsenal",
        awayTeam: "Chelsea",
        league: "Premier League",
        homeRates: STUB_RATES,
        awayRates: STUB_RATES,
        lgAf1: 1.1,
        lgAf2: 1.0,
      },
    },
    { skipCache: true }
  );
}
