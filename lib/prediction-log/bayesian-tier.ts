import { BAYESIAN_CONFIG } from "./bayesian-config";
import type { RecommendationTier } from "./types";
import type { LeagueCharacterProfile } from "./types";
import { intervalWidthScaleFromLeague } from "./league-character";

export function passesBayesianIntervalGate(
  tier: RecommendationTier,
  intervalWidth: number | undefined | null
): boolean {
  if (!BAYESIAN_CONFIG.BAYESIAN_FEEDS_SIGNAL) return true;
  if (intervalWidth == null) return true;
  if (tier === "safe") return intervalWidth <= BAYESIAN_CONFIG.MAX_INTERVAL_WIDTH_SAFE;
  if (tier === "balanced") return intervalWidth <= BAYESIAN_CONFIG.MAX_INTERVAL_WIDTH_BALANCED;
  return true;
}

export function bayesianRiskMultiplier(
  intervalWidth: number | undefined | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): number {
  if (!BAYESIAN_CONFIG.BAYESIAN_FEEDS_SIGNAL) return 1;
  if (intervalWidth == null) return intervalWidthScaleFromLeague(leagueCharacterProfile ?? null);
  return (1 + intervalWidth * 0.5) * intervalWidthScaleFromLeague(leagueCharacterProfile ?? null);
}
