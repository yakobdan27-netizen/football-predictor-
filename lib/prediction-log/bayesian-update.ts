import { BAYESIAN_CONFIG } from "./bayesian-config";
import type {
  BayesianMarketKey,
  BetaPosterior,
  ClubBayesianMarkets,
  ClubRecord,
  GammaPosterior,
} from "./club-record-types";
import type { LeagueBaselinesStore } from "./league-baselines";
import { lookupTeam } from "./teams-quality";
import type { TeamsQualityStore } from "./teams-quality-types";
import type { LogMatch } from "./types";
import type { QualityTier } from "./teams-quality-types";

const GAMMA_COUNT_KEYS: BayesianMarketKey[] = [
  "goals_scored_home",
  "goals_scored_away",
  "goals_conceded_home",
  "goals_conceded_away",
  "shots_on_target",
  "total_shots",
  "corners",
  "yellow_cards",
  "red_cards",
  "fouls",
];

const BETA_RATE_KEYS: BayesianMarketKey[] = ["win_rate", "btts_rate", "clean_sheet_rate"];

function tierBoost(tier: QualityTier | null): number {
  if (!tier) return 0;
  return BAYESIAN_CONFIG.TIER_PRIOR_BOOST[tier] ?? 0;
}

export function createGammaPrior(tier: QualityTier | null = null): GammaPosterior {
  const boost = tierBoost(tier);
  const { shape, rate } = BAYESIAN_CONFIG.GAMMA_PRIOR_DEFAULT;
  const priorShape = Math.max(0.5, shape + boost);
  const priorRate = rate;
  const now = new Date().toISOString();
  return {
    type: "gamma",
    prior: { shape: priorShape, rate: priorRate },
    posterior: { shape: priorShape, rate: priorRate },
    n: 0,
    lastUpdated: now,
  };
}

export function createBetaPrior(tier: QualityTier | null = null): BetaPosterior {
  const boost = tierBoost(tier);
  const { alpha, beta } = BAYESIAN_CONFIG.BETA_PRIOR_DEFAULT;
  const priorAlpha = Math.max(1, alpha + boost * 2);
  const priorBeta = Math.max(1, beta - boost);
  const now = new Date().toISOString();
  return {
    type: "beta",
    prior: { alpha: priorAlpha, beta: priorBeta },
    posterior: { alpha: priorAlpha, beta: priorBeta },
    n: 0,
    lastUpdated: now,
  };
}

export function initBayesianMarkets(tier: QualityTier | null = null): ClubBayesianMarkets {
  const markets: ClubBayesianMarkets["markets"] = {};
  for (const key of GAMMA_COUNT_KEYS) {
    markets[key] = createGammaPrior(tier);
  }
  for (const key of BETA_RATE_KEYS) {
    markets[key] = createBetaPrior(tier);
  }
  return { markets, version: 1 };
}

export function decayGamma(state: GammaPosterior, gamma = BAYESIAN_CONFIG.FORM_DECAY_GAMMA): GammaPosterior {
  const { prior, posterior } = state;
  return {
    ...state,
    posterior: {
      shape: prior.shape + (posterior.shape - prior.shape) * gamma,
      rate: prior.rate + (posterior.rate - prior.rate) * gamma,
    },
    lastUpdated: new Date().toISOString(),
  };
}

export function decayBeta(state: BetaPosterior, gamma = BAYESIAN_CONFIG.FORM_DECAY_GAMMA): BetaPosterior {
  const { prior, posterior } = state;
  return {
    ...state,
    posterior: {
      alpha: prior.alpha + (posterior.alpha - prior.alpha) * gamma,
      beta: prior.beta + (posterior.beta - prior.beta) * gamma,
    },
    lastUpdated: new Date().toISOString(),
  };
}

export function updateGamma(state: GammaPosterior, count: number): GammaPosterior {
  const decayed = decayGamma(state);
  const x = Math.max(0, count);
  return {
    ...decayed,
    posterior: {
      shape: decayed.posterior.shape + x,
      rate: decayed.posterior.rate + 1,
    },
    n: decayed.n + 1,
    lastUpdated: new Date().toISOString(),
  };
}

export function updateBeta(state: BetaPosterior, success: boolean): BetaPosterior {
  const decayed = decayBeta(state);
  return {
    ...decayed,
    posterior: {
      alpha: decayed.posterior.alpha + (success ? 1 : 0),
      beta: decayed.posterior.beta + (success ? 0 : 1),
    },
    n: decayed.n + 1,
    lastUpdated: new Date().toISOString(),
  };
}

export function gammaMean(state: GammaPosterior): number {
  const { shape, rate } = state.posterior;
  return rate > 0 ? shape / rate : 0;
}

export function betaMean(state: BetaPosterior): number {
  const { alpha, beta } = state.posterior;
  const denom = alpha + beta;
  return denom > 0 ? alpha / denom : 0.5;
}

function ensureMarkets(record: ClubRecord, tier: QualityTier | null): ClubBayesianMarkets {
  if (record.bayesianMarkets?.version === 1) return record.bayesianMarkets;
  return initBayesianMarkets(tier);
}

function getGamma(markets: ClubBayesianMarkets, key: BayesianMarketKey, tier: QualityTier | null): GammaPosterior {
  const existing = markets.markets[key];
  if (existing?.type === "gamma") return existing;
  return createGammaPrior(tier);
}

function getBeta(markets: ClubBayesianMarkets, key: BayesianMarketKey, tier: QualityTier | null): BetaPosterior {
  const existing = markets.markets[key];
  if (existing?.type === "beta") return existing;
  return createBetaPrior(tier);
}

export interface BayesianObservation {
  marketKey: BayesianMarketKey;
  gammaCount?: number;
  betaSuccess?: boolean;
}

export function applyBayesianObservation(
  record: ClubRecord,
  obs: BayesianObservation,
  tier: QualityTier | null = null
): ClubRecord {
  if (!BAYESIAN_CONFIG.USE_BAYESIAN_LAYER) return record;

  const markets = ensureMarkets(record, tier);
  const updated = { ...markets.markets };

  if (obs.gammaCount != null && GAMMA_COUNT_KEYS.includes(obs.marketKey)) {
    const current = getGamma(markets, obs.marketKey, tier);
    updated[obs.marketKey] = updateGamma(current, obs.gammaCount);
  }
  if (obs.betaSuccess != null && BETA_RATE_KEYS.includes(obs.marketKey)) {
    const current = getBeta(markets, obs.marketKey, tier);
    updated[obs.marketKey] = updateBeta(current, obs.betaSuccess);
  }

  return {
    ...record,
    bayesianMarkets: { markets: updated, version: 1 },
    lastUpdated: new Date().toISOString(),
  };
}

function parseGoalsFromOu(actual: string | number | undefined): number | null {
  if (typeof actual === "number" && Number.isFinite(actual)) return actual;
  if (typeof actual !== "string") return null;
  const m = actual.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]!) : null;
}

export function applyBayesianFromMatch(
  record: ClubRecord,
  match: LogMatch,
  venue: "home" | "away",
  teamsQuality: TeamsQualityStore | null = null,
  _leagueBaselines: LeagueBaselinesStore | null = null
): ClubRecord {
  if (!BAYESIAN_CONFIG.USE_BAYESIAN_LAYER) return record;

  const tier = lookupTeam(teamsQuality, record.clubName)?.tier ?? null;
  let updated = record;

  const goalsMarket = venue === "home" ? "home_goals_ou" : "away_goals_ou";
  const concededMarket = venue === "home" ? "away_goals_ou" : "home_goals_ou";

  const goalsActual = match.actualResults[goalsMarket]?.actual;
  const concededActual = match.actualResults[concededMarket]?.actual;
  const goalsScored = parseGoalsFromOu(goalsActual);
  const goalsConceded = parseGoalsFromOu(concededActual);

  if (goalsScored != null) {
    updated = applyBayesianObservation(updated, {
      marketKey: venue === "home" ? "goals_scored_home" : "goals_scored_away",
      gammaCount: goalsScored,
    }, tier);
  }
  if (goalsConceded != null) {
    updated = applyBayesianObservation(updated, {
      marketKey: venue === "home" ? "goals_conceded_home" : "goals_conceded_away",
      gammaCount: goalsConceded,
    }, tier);
    if (goalsConceded === 0) {
      updated = applyBayesianObservation(updated, {
        marketKey: "clean_sheet_rate",
        betaSuccess: true,
      }, tier);
    } else {
      updated = applyBayesianObservation(updated, {
        marketKey: "clean_sheet_rate",
        betaSuccess: false,
      }, tier);
    }
  }

  const actual1x2 = match.actualResults["1x2"]?.actual;
  if (actual1x2 != null) {
    const sideWin =
      venue === "home"
        ? String(actual1x2).toLowerCase() === "home"
        : String(actual1x2).toLowerCase() === "away";
    const isDraw = String(actual1x2).toLowerCase() === "draw";
    if (!isDraw) {
      updated = applyBayesianObservation(updated, {
        marketKey: "win_rate",
        betaSuccess: sideWin,
      }, tier);
    }
  }

  const bttsActual = match.actualResults["btts"]?.actual;
  if (bttsActual != null) {
    const yes = String(bttsActual).toLowerCase() === "yes";
    updated = applyBayesianObservation(updated, {
      marketKey: "btts_rate",
      betaSuccess: yes,
    }, tier);
  }

  const ts = match.teamStats?.[venue];
  if (ts) {
    if (ts.shotsOnTarget != null) {
      updated = applyBayesianObservation(updated, {
        marketKey: "shots_on_target",
        gammaCount: ts.shotsOnTarget,
      }, tier);
    }
    if (ts.totalShots != null) {
      updated = applyBayesianObservation(updated, {
        marketKey: "total_shots",
        gammaCount: ts.totalShots,
      }, tier);
    }
    if (ts.corners != null) {
      updated = applyBayesianObservation(updated, {
        marketKey: "corners",
        gammaCount: ts.corners,
      }, tier);
    }
    if (ts.yellowCards != null) {
      updated = applyBayesianObservation(updated, {
        marketKey: "yellow_cards",
        gammaCount: ts.yellowCards,
      }, tier);
    }
    if (ts.redCards != null) {
      updated = applyBayesianObservation(updated, {
        marketKey: "red_cards",
        gammaCount: ts.redCards,
      }, tier);
    }
    if (ts.fouls != null) {
      updated = applyBayesianObservation(updated, {
        marketKey: "fouls",
        gammaCount: ts.fouls,
      }, tier);
    }
  }

  return updated;
}

export function tightenGammaPrior(state: GammaPosterior, factor = 1.1): GammaPosterior {
  const { prior, posterior } = state;
  const newRate = posterior.rate * factor;
  const pulledRate = prior.rate + (newRate - prior.rate);
  return {
    ...state,
    posterior: {
      shape: prior.shape + (posterior.shape - prior.shape) * 0.85,
      rate: pulledRate,
    },
    lastUpdated: new Date().toISOString(),
  };
}

export function tightenBetaPrior(state: BetaPosterior, pull = 0.15): BetaPosterior {
  const { prior, posterior } = state;
  return {
    ...state,
    posterior: {
      alpha: posterior.alpha + (prior.alpha - posterior.alpha) * pull,
      beta: posterior.beta + (prior.beta - posterior.beta) * pull,
    },
    lastUpdated: new Date().toISOString(),
  };
}
