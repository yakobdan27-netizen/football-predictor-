/**
 * Recompute all hist-derived Postgres tables (betas, priors, half stats, ratings).
 */
import { recomputeLeaguePriors } from "./league-priors";
import { persistTeamHalfStatsFromHist } from "./persist-team-half-stats";
import {
  discoverDomesticTeamsFromHist,
  persistDomesticTeamRatings,
} from "./persist-team-ratings";
import { recomputeLeagueBetas } from "./recompute-betas";

export type RecomputeDerivedResult = {
  ok: boolean;
  betas: Awaited<ReturnType<typeof recomputeLeagueBetas>>;
  priors: Awaited<ReturnType<typeof recomputeLeaguePriors>>;
  teamHalfStats: Awaited<ReturnType<typeof persistTeamHalfStatsFromHist>>;
  teamRatings: { written: number; teamsByLeague: Record<string, number> };
};

export async function recomputeDerivedFromHist(): Promise<RecomputeDerivedResult> {
  const betas = await recomputeLeagueBetas();
  const priors = await recomputeLeaguePriors();
  const half = await persistTeamHalfStatsFromHist();
  const teamsByLeague = await discoverDomesticTeamsFromHist();
  const teamsByLeagueCounts = Object.fromEntries(
    Object.entries(teamsByLeague).map(([k, v]) => [k, v.length])
  );
  const written = await persistDomesticTeamRatings(teamsByLeague);
  return {
    ok: true,
    betas,
    priors,
    teamHalfStats: half,
    teamRatings: { written, teamsByLeague: teamsByLeagueCounts },
  };
}
