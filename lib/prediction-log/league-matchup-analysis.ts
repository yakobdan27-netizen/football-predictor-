/**
 * League matchup analysis — 60% API season rates · 40% seed/form priors when both exist.
 */
import {
  bttsFromMatrix,
  buildScoreMatrix,
  outcomeProbsFromMatrix,
  overUnderFromMatrix,
} from "@/lib/predictor/score-matrix";
import { analyzeCorrectScore } from "./correct-score";
import { seedCorrectScoreLambdas } from "./correct-score-seed";
import { apiCorrectScoreLambdas } from "./league-matchup-api-lambdas";
import {
  blendBadgeLabel,
  blendTripleBadgeLabel,
  PREDICTION_WEIGHTS,
  weightedEstimate,
  weightedTripleEstimate,
  type BlendSource,
} from "./prediction-weights";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";

export interface LeagueMatchupAnalysis {
  mode: "reference";
  homeTeam: string;
  awayTeam: string;
  league: string;
  lambdaHome: number;
  lambdaAway: number;
  source: string;
  /** 60/40 blend provenance when API + seed combined. */
  blendSource?: BlendSource;
  apiWeight?: number;
  formWeight?: number;
  expectedScore: string;
  mostLikelyScore: string;
  mostLikelyProbPct: number;
  winProbability: { home: number; draw: number; away: number };
  overUnder25: { over: number; under: number };
  bothTeamsToScore: { yes: number; no: number };
}

function pct(p: number): number {
  return Math.round(p * 1000) / 10;
}

export function buildLeagueMatchupAnalysis(
  homeTeam: string,
  awayTeam: string,
  league: string,
  lambdaHome: number,
  lambdaAway: number,
  source: string,
  blend?: { blendSource: BlendSource; apiWeight: number; formWeight: number }
): LeagueMatchupAnalysis {
  const grid = buildScoreMatrix(
    lambdaHome,
    lambdaAway,
    STAT_ENGINE_CONFIG.DIXON_COLES_RHO,
    STAT_ENGINE_CONFIG.SCORE_GRID_MAX
  );
  const analysis = analyzeCorrectScore(grid);
  const outcomes = outcomeProbsFromMatrix(grid);
  const [over, under] = overUnderFromMatrix(grid, 2.5);
  const btts = bttsFromMatrix(grid);

  const expectedHome = Math.round(lambdaHome);
  const expectedAway = Math.round(lambdaAway);

  return {
    mode: "reference",
    homeTeam,
    awayTeam,
    league,
    lambdaHome,
    lambdaAway,
    source,
    blendSource: blend?.blendSource,
    apiWeight: blend?.apiWeight,
    formWeight: blend?.formWeight,
    expectedScore: `${expectedHome}-${expectedAway}`,
    mostLikelyScore: analysis
      ? `${analysis.mostLikely.home}-${analysis.mostLikely.away}`
      : `${expectedHome}-${expectedAway}`,
    mostLikelyProbPct: analysis?.mostLikely.probPct ?? 0,
    winProbability: {
      home: pct(outcomes.home),
      draw: pct(outcomes.draw),
      away: pct(outcomes.away),
    },
    overUnder25: { over: pct(over), under: pct(under) },
    bothTeamsToScore: { yes: pct(btts.yes), no: pct(btts.no) },
  };
}

/** Blend API λ with seed/form λ at canonical 60/40 weights. */
export function blendMatchupLambdas(
  api: { lambdaHome: number; lambdaAway: number } | null,
  form: { lambdaHome: number; lambdaAway: number }
): {
  lambdaHome: number;
  lambdaAway: number;
  blendSource: BlendSource;
  apiWeight: number;
  formWeight: number;
} {
  const homeBlend = weightedEstimate(api?.lambdaHome, form.lambdaHome);
  const awayBlend = weightedEstimate(api?.lambdaAway, form.lambdaAway);

  const blendSource: BlendSource =
    homeBlend?.source === "blended" || awayBlend?.source === "blended"
      ? "blended"
      : homeBlend?.source === "api_only" || awayBlend?.source === "api_only"
        ? "api_only"
        : "manual_ai_only";

  return {
    lambdaHome: homeBlend?.value ?? form.lambdaHome,
    lambdaAway: awayBlend?.value ?? form.lambdaAway,
    blendSource,
    apiWeight: homeBlend?.apiWeight ?? awayBlend?.apiWeight ?? 0,
    formWeight: homeBlend?.manualAiWeight ?? awayBlend?.manualAiWeight ?? 1,
  };
}

/** Blend recent / prior / system λ at 30/30/40 weights. */
export function blendMatchupLambdasTriple(
  recent: { lambdaHome: number; lambdaAway: number } | null,
  prior: { lambdaHome: number; lambdaAway: number },
  system: { lambdaHome: number; lambdaAway: number } | null
): {
  lambdaHome: number;
  lambdaAway: number;
  blendSource: BlendSource;
  apiWeight: number;
  formWeight: number;
} {
  const homeBlend = weightedTripleEstimate(
    recent?.lambdaHome,
    prior.lambdaHome,
    system?.lambdaHome
  );
  const awayBlend = weightedTripleEstimate(
    recent?.lambdaAway,
    prior.lambdaAway,
    system?.lambdaAway
  );

  const blendSource: BlendSource =
    homeBlend?.source === "blended" || awayBlend?.source === "blended"
      ? "blended"
      : homeBlend?.source === "api_only" || awayBlend?.source === "api_only"
        ? "api_only"
        : "manual_ai_only";

  return {
    lambdaHome: homeBlend?.value ?? prior.lambdaHome,
    lambdaAway: awayBlend?.value ?? prior.lambdaAway,
    blendSource,
    apiWeight: homeBlend?.apiWeight ?? awayBlend?.apiWeight ?? 0,
    formWeight: homeBlend?.manualAiWeight ?? awayBlend?.manualAiWeight ?? 1,
  };
}

function formatSource(
  blendSource: BlendSource,
  apiSource: string | null,
  formSource: string
): string {
  if (blendSource === "blended") {
    return `${blendBadgeLabel("blended")} · API (${apiSource ?? "season stats"}) + form (${formSource})`;
  }
  if (blendSource === "api_only") {
    return apiSource ?? "API season statistics";
  }
  return formSource;
}

/** Seed/form-only reference (sync — decision maker & tests). */
export function getLeagueMatchupAnalysis(
  homeTeam: string,
  awayTeam: string,
  league: string
): LeagueMatchupAnalysis | null {
  const seeded = seedCorrectScoreLambdas(homeTeam, awayTeam, league);
  if (!seeded) return null;

  return buildLeagueMatchupAnalysis(
    homeTeam,
    awayTeam,
    league,
    seeded.lambdaHome,
    seeded.lambdaAway,
    seeded.source,
    {
      blendSource: "manual_ai_only",
      apiWeight: 0,
      formWeight: 1,
    }
  );
}

/** 30% last-5 MC · 30% prior API · 40% system-season (async — league analysis page). */
export async function getBlendedLeagueMatchupAnalysis(
  homeTeam: string,
  awayTeam: string,
  league: string,
  opts?: { season?: number }
): Promise<LeagueMatchupAnalysis | null> {
  const { isSystemSeasonBlendEnabled } = await import(
    "@/lib/system-season/feature-flags"
  );

  if (isSystemSeasonBlendEnabled()) {
    const prior = seedCorrectScoreLambdas(homeTeam, awayTeam, league);
    if (!prior) return null;
    const { systemSeasonMatchupLambdas, recentLast5MatchupLambdas } =
      await import("@/lib/system-season/blend-adapter");
    const [current, recent] = await Promise.all([
      systemSeasonMatchupLambdas(homeTeam, awayTeam, league),
      recentLast5MatchupLambdas(homeTeam, awayTeam, league),
    ]);
    const blended = blendMatchupLambdasTriple(
      recent,
      { lambdaHome: prior.lambdaHome, lambdaAway: prior.lambdaAway },
      current
    );
    const source = `${blendTripleBadgeLabel()} · prior (${prior.source}) · ${recent?.source ?? "last-5 pending"} · ${current?.source ?? "system-season pending"}`;
    return buildLeagueMatchupAnalysis(
      homeTeam,
      awayTeam,
      league,
      blended.lambdaHome,
      blended.lambdaAway,
      source,
      {
        blendSource: blended.blendSource,
        apiWeight: blended.apiWeight,
        formWeight: blended.formWeight,
      }
    );
  }

  const form = seedCorrectScoreLambdas(homeTeam, awayTeam, league);
  if (!form) return null;

  const api = await apiCorrectScoreLambdas(homeTeam, awayTeam, league, {
    season: opts?.season,
  });

  const blended = blendMatchupLambdas(api, form);
  const source = formatSource(
    blended.blendSource,
    api?.source ?? null,
    form.source
  );

  return buildLeagueMatchupAnalysis(
    homeTeam,
    awayTeam,
    league,
    blended.lambdaHome,
    blended.lambdaAway,
    source,
    {
      blendSource: blended.blendSource,
      apiWeight: blended.apiWeight,
      formWeight: blended.formWeight,
    }
  );
}

export { PREDICTION_WEIGHTS as LEAGUE_MATCHUP_BLEND_WEIGHTS };
