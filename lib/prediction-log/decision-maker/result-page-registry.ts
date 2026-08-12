/**
 * Central registry of every result-producing page the Decision Maker consumes.
 * Add new analysis pages here — the engine discovers them automatically.
 *
 * WEIGHTING-EXEMPT: Page source weights (0.3/0.2/…) and candidate confidence
 * wiring are NOT rebalanced via weightedEstimate (60/40 API↔Manual). Reco
 * markets may already carry hybridConfidence from the recommendation blend.
 */
import { leanLabel } from "../corners-model";
import { getLeagueMatchupAnalysis } from "../league-matchup-analysis";
import { LOG_MARKET_MAP, pickOptionsForMarket } from "../markets-config";
import { matchLeague } from "../match-league";
import { getSelectedPickForMatch } from "../snapshot-readers";
import type { LogMarketKey } from "../types";
import { bandToConfidence, clampConfidence } from "./confidence";
import { eventProbPctFromScoreGrid } from "../goal-distribution";
import {
  cfeDisplayProbPct,
  cfeMatchOutcomePct,
} from "../canonical-fixture-estimate";
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
  // Tangible-data gate: never surface insufficient / empty picks.
  if (pick.insufficientData) return [];
  const label = predictionLabel(
    marketKey,
    pick.prediction,
    pick.line,
    ctx.match.homeTeam,
    ctx.match.awayTeam
  );
  const cfe = ctx.caches.cfeByMatchId.get(ctx.match.id);
  let cfePct =
    cfe != null
      ? cfeDisplayProbPct(cfe, marketKey, pick.prediction, pick.line)
      : null;
  if (cfePct == null && cfe != null && (marketKey === "1x2" || marketKey === "ht_1x2")) {
    cfePct = cfeMatchOutcomePct(
      cfe,
      label,
      ctx.match.homeTeam,
      ctx.match.awayTeam
    );
  }
  const grid = pick.mathSnapshot?.statLayer?.scoreGrid;
  const distPct =
    grid != null
      ? eventProbPctFromScoreGrid(
          marketKey,
          label,
          pick.line,
          grid,
          ctx.match.homeTeam,
          ctx.match.awayTeam
        )
      : null;
  const conf = clampConfidence(
    cfePct ?? distPct ?? pick.hybridConfidence ?? pick.pFinal ?? pick.confidence ?? 0
  );
  if (!(conf > 0)) return [];
  const def = LOG_MARKET_MAP[marketKey];
  return [
    {
      marketKey,
      label: def?.label ?? marketKey,
      prediction: label,
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
  if (!p || p.lean === "lean_none") {
    // No tangible lean — do not invent a corners pick for top-3.
    return [];
  }
  const conf = bandToConfidence(p.confidence, p.topProbability);
  if (!(conf > 0)) return [];
  return [
    {
      marketKey: "corners_ou",
      label: "Total corners O/U",
      prediction: leanLabel(p.lean),
      confidence: conf,
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
  // Seed-only / low band without probability → skip.
  if (p.confidence === "low" && !(p.topProbability > 0)) return [];
  const conf = bandToConfidence(p.confidence, p.topProbability);
  if (!(conf > 0)) return [];
  return [
    {
      marketKey: "hsh",
      label: "Half goals (1H vs 2H)",
      prediction: p.recommended === "Tie" ? "Tie" : `${p.recommended} more goals`,
      confidence: conf,
      category: "specialized",
      pageId: "highest-scoring-half",
      pageLabel: "Half Goals",
    },
  ];
}

function fromDieh(ctx: DecisionFetchContext): DecisionMarketCandidate[] {
  const est = ctx.caches.cfeByMatchId.get(ctx.match.id);
  const dieh = est?.markets.dieh;
  if (!dieh || dieh.status !== "ok" || dieh.diehYes == null || dieh.diehNo == null) {
    return [];
  }
  const yes = dieh.diehYes >= dieh.diehNo;
  return [
    {
      marketKey: "draw_one_half",
      label: "Draw in either half",
      prediction: yes ? "Yes" : "No",
      confidence: clampConfidence((yes ? dieh.diehYes : dieh.diehNo) * 100),
      category: "specialized",
      pageId: "draw-either-half-analysis",
      pageLabel: "Draw Either Half",
    },
  ];
}

function fromTotalGoals(ctx: DecisionFetchContext): DecisionMarketCandidate[] {
  const est = ctx.caches.cfeByMatchId.get(ctx.match.id);
  if (!est) return [];
  const over = est.markets.over25;
  const under = est.markets.under25;
  const takeOver = over >= under;
  return [
    {
      marketKey: "total_goals_ou",
      label: "Total goals O/U",
      prediction: takeOver ? "Over 2.5" : "Under 2.5",
      confidence: clampConfidence((takeOver ? over : under) * 100),
      category: "goals",
      pageId: "total-goals-analysis",
      pageLabel: "Total Goals",
      line: 2.5,
    },
  ];
}

/**
 * League seed analysis — only when CFE is present (tangible fixture estimate).
 * Prefer CFE 1X2 / BTTS so seed Poisson never contradicts CFE at equal %.
 */
function fromLeagueAnalysis(ctx: DecisionFetchContext): DecisionMarketCandidate[] {
  const cfe = ctx.caches.cfeByMatchId.get(ctx.match.id);
  // Without CFE there is no tangible fixture estimate — skip seed-only pubs.
  if (!cfe) return [];

  const out: DecisionMarketCandidate[] = [];
  const home = cfe.markets.home;
  const draw = cfe.markets.draw;
  const away = cfe.markets.away;
  const best =
    home >= draw && home >= away
      ? { side: "home" as const, conf: home, label: ctx.match.homeTeam }
      : away >= draw
        ? { side: "away" as const, conf: away, label: ctx.match.awayTeam }
        : { side: "draw" as const, conf: draw, label: "Draw" };

  out.push({
    marketKey: "1x2",
    label: "Match result (1X2)",
    prediction: best.label,
    confidence: clampConfidence(best.conf * 100),
    category: "goals",
    pageId: "league-analysis",
    pageLabel: "League Analysis",
  });

  const bttsYes = cfe.markets.bttsYes;
  const bttsNo = cfe.markets.bttsNo;
  if (bttsYes != null && bttsNo != null) {
    const takeYes = bttsYes >= bttsNo;
    out.push({
      marketKey: "btts",
      label: "Both teams to score",
      prediction: takeYes ? "BTTS Yes" : "BTTS No",
      confidence: clampConfidence((takeYes ? bttsYes : bttsNo) * 100),
      category: "goals",
      pageId: "league-analysis",
      pageLabel: "League Analysis",
    });
  }

  // Correct score still from seed grid when available (reference), low weight via page.
  const league = matchLeague(ctx.match, ctx.batch.league);
  const a = getLeagueMatchupAnalysis(ctx.match.homeTeam, ctx.match.awayTeam, league);
  if (a && a.mostLikelyProbPct > 0) {
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
    pageId: "total-goals-analysis",
    pageLabel: "Total Goals",
    href: "/total-goals-analysis",
    baseWeight: 0.15,
    fetchResults: fromTotalGoals,
  },
  {
    pageId: "draw-either-half-analysis",
    pageLabel: "Draw Either Half",
    href: "/draw-either-half-analysis",
    baseWeight: 0.1,
    fetchResults: fromDieh,
  },
  {
    pageId: "league-analysis",
    pageLabel: "League Analysis",
    href: "/league-analysis",
    baseWeight: 0.1,
    fetchResults: fromLeagueAnalysis,
  },
  /**
   * Discovery-only: 5th Decision Maker slot is built in process-batch.
   * fetchResults returns [] so this never enters top-3 scoring.
   */
  {
    pageId: "user-market-evaluation",
    pageLabel: "User Market Evaluation",
    href: "/decision-maker",
    baseWeight: 0,
    fetchResults: () => [],
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
