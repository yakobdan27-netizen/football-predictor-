/**
 * Central registry of every result-producing page the Decision Maker consumes.
 * Add new analysis pages here — the engine discovers them automatically.
 */
import { leanLabel } from "../corners-model";
import { recommendationLabel as concededLabel } from "../conceded-half-model";
import { getLeagueMatchupAnalysis } from "../league-matchup-analysis";
import { LOG_MARKET_MAP, pickOptionsForMarket } from "../markets-config";
import { matchLeague } from "../match-league";
import { getSelectedPickForMatch } from "../snapshot-readers";
import type { LogMarketKey } from "../types";
import { bandToConfidence, clampConfidence } from "./confidence";
import { categoryForLogMarket } from "./market-category";
import type {
  DecisionFetchContext,
  DecisionMarketCandidate,
  ResultPageDefinition,
} from "./types";

function predictionLabel(
  marketKey: LogMarketKey,
  prediction: string,
  line: number | undefined,
  homeTeam: string,
  awayTeam: string
): string {
  const opts = pickOptionsForMarket(marketKey, homeTeam, awayTeam, line);
  return opts.find((o) => o.value === prediction)?.label ?? prediction;
}

function fromRecommendation(ctx: DecisionFetchContext): DecisionMarketCandidate[] {
  const rm = ctx.batch.recommended?.matches.find((m) => m.id === ctx.match.id);
  if (!rm) return [];
  const selected = getSelectedPickForMatch(rm);
  if (!selected) return [];
  const { marketKey, pick } = selected;
  const conf = clampConfidence(
    pick.hybridConfidence ?? pick.pFinal ?? pick.confidence ?? 0
  );
  const def = LOG_MARKET_MAP[marketKey];
  return [
    {
      marketKey,
      label: def?.label ?? marketKey,
      prediction: predictionLabel(
        marketKey,
        pick.prediction,
        pick.line,
        ctx.match.homeTeam,
        ctx.match.awayTeam
      ),
      confidence: conf,
      category: categoryForLogMarket(marketKey),
      pageId: "recommendation",
      pageLabel: "Recommendation / AI Hybrid",
      line: pick.line,
    },
  ];
}

function fromCorners(ctx: DecisionFetchContext): DecisionMarketCandidate[] {
  const p = ctx.caches.cornersByMatchId.get(ctx.match.id);
  if (!p || p.lean === "lean_none") return [];
  return [
    {
      marketKey: "corners_ou",
      label: "Total corners O/U",
      prediction: leanLabel(p.lean),
      confidence: bandToConfidence(p.confidence, p.topProbability),
      category: "corners",
      pageId: "corners-analysis",
      pageLabel: "Corners Analysis",
      line: 9.5,
    },
  ];
}

function fromHsh(ctx: DecisionFetchContext): DecisionMarketCandidate[] {
  const p = ctx.caches.hshByMatchId.get(ctx.match.id);
  if (!p) return [];
  return [
    {
      marketKey: "hsh",
      label: "Half goals (1H vs 2H)",
      prediction: p.recommended === "Tie" ? "Tie" : `${p.recommended} more goals`,
      confidence: bandToConfidence(p.confidence, p.topProbability),
      category: "specialized",
      pageId: "highest-scoring-half",
      pageLabel: "Half Goals",
    },
  ];
}

function fromConceded(ctx: DecisionFetchContext): DecisionMarketCandidate[] {
  const p = ctx.caches.concededByMatchId.get(ctx.match.id);
  if (!p) return [];
  return [
    {
      marketKey: "conceded_half",
      label: "Conceded half lean",
      prediction: concededLabel(p.recommendation),
      confidence: bandToConfidence(p.confidence, p.topProbability),
      category: "specialized",
      pageId: "conceded-half",
      pageLabel: "Conceded Half",
    },
  ];
}

function fromLeagueAnalysis(ctx: DecisionFetchContext): DecisionMarketCandidate[] {
  const league = matchLeague(ctx.match, ctx.batch.league);
  const a = getLeagueMatchupAnalysis(ctx.match.homeTeam, ctx.match.awayTeam, league);
  if (!a) return [];
  const out: DecisionMarketCandidate[] = [];

  const w = a.winProbability;
  const bestOutcome =
    w.home >= w.draw && w.home >= w.away
      ? { key: "home", label: "Home", conf: w.home }
      : w.away >= w.draw
        ? { key: "away", label: "Away", conf: w.away }
        : { key: "draw", label: "Draw", conf: w.draw };
  out.push({
    marketKey: "1x2",
    label: "Match result (1X2)",
    prediction: bestOutcome.label,
    confidence: clampConfidence(bestOutcome.conf),
    category: "goals",
    pageId: "league-analysis",
    pageLabel: "League Analysis",
  });

  const ou =
    a.overUnder25.over >= a.overUnder25.under
      ? { pred: "Over 2.5", conf: a.overUnder25.over }
      : { pred: "Under 2.5", conf: a.overUnder25.under };
  out.push({
    marketKey: "total_goals_ou",
    label: "Total goals O/U",
    prediction: ou.pred,
    confidence: clampConfidence(ou.conf),
    category: "goals",
    pageId: "league-analysis",
    pageLabel: "League Analysis",
    line: 2.5,
  });

  const btts =
    a.bothTeamsToScore.yes >= a.bothTeamsToScore.no
      ? { pred: "BTTS Yes", conf: a.bothTeamsToScore.yes }
      : { pred: "BTTS No", conf: a.bothTeamsToScore.no };
  out.push({
    marketKey: "btts",
    label: "Both teams to score",
    prediction: btts.pred,
    confidence: clampConfidence(btts.conf),
    category: "goals",
    pageId: "league-analysis",
    pageLabel: "League Analysis",
  });

  if (a.mostLikelyProbPct > 0) {
    out.push({
      marketKey: "correct_score",
      label: "Correct score",
      prediction: a.mostLikelyScore,
      confidence: clampConfidence(a.mostLikelyProbPct),
      category: "specialized",
      pageId: "league-analysis",
      pageLabel: "League Analysis",
    });
  }

  return out;
}

/**
 * Register every page that publishes market results.
 * Weights are relative; the engine normalises across sources that returned data.
 */
export const RESULT_PAGE_REGISTRY: ResultPageDefinition[] = [
  {
    pageId: "recommendation",
    pageLabel: "Recommendation / AI Hybrid",
    href: "/recommendation",
    baseWeight: 0.3,
    fetchResults: fromRecommendation,
  },
  {
    pageId: "corners-analysis",
    pageLabel: "Corners Analysis",
    href: "/corners-analysis",
    baseWeight: 0.2,
    fetchResults: fromCorners,
  },
  {
    pageId: "highest-scoring-half",
    pageLabel: "Half Goals",
    href: "/highest-scoring-half",
    baseWeight: 0.15,
    fetchResults: fromHsh,
  },
  {
    pageId: "conceded-half",
    pageLabel: "Conceded Half",
    href: "/conceded-half-analysis",
    baseWeight: 0.05,
    fetchResults: fromConceded,
  },
  {
    pageId: "league-analysis",
    pageLabel: "League Analysis",
    href: "/league-analysis",
    baseWeight: 0.15,
    fetchResults: fromLeagueAnalysis,
  },
];

export function listRegisteredResultPages(): Omit<ResultPageDefinition, "fetchResults">[] {
  return RESULT_PAGE_REGISTRY.map(({ pageId, pageLabel, href, baseWeight }) => ({
    pageId,
    pageLabel,
    href,
    baseWeight,
  }));
}
