import { marketIdentity } from "./market-category";
import type {
  AggregatedMatchData,
  DecisionMarketCandidate,
  MatchSourceBundle,
  ScoredDecisionMarket,
} from "./types";
import { DECISION_MIN_CONFIDENCE, DECISION_MIN_SOURCES } from "./types";
import { RESULT_PAGE_REGISTRY } from "./result-page-registry";
import type { DecisionFetchContext } from "./types";

/** Pull markets from every registered result page; soft-fail per source. */
export function aggregateMatchData(ctx: DecisionFetchContext): AggregatedMatchData {
  const sources: MatchSourceBundle[] = RESULT_PAGE_REGISTRY.map((page) => {
    try {
      const markets = page.fetchResults(ctx);
      return {
        pageId: page.pageId,
        pageLabel: page.pageLabel,
        baseWeight: page.baseWeight,
        markets,
        ok: markets.length > 0,
      };
    } catch (e) {
      return {
        pageId: page.pageId,
        pageLabel: page.pageLabel,
        baseWeight: page.baseWeight,
        markets: [],
        ok: false,
        error: e instanceof Error ? e.message : "Source failed",
      };
    }
  });

  return {
    matchId: ctx.match.id,
    batchId: ctx.batch.id,
    sources,
  };
}

/**
 * Normalise base weights across sources that returned data so they sum to 1.0.
 */
export function normalisedSourceWeights(
  sources: MatchSourceBundle[]
): Map<string, number> {
  const available = sources.filter((s) => s.ok && s.markets.length > 0);
  const map = new Map<string, number>();
  const sum = available.reduce((acc, s) => acc + s.baseWeight, 0);
  if (sum <= 0) return map;
  for (const s of available) {
    map.set(s.pageId, s.baseWeight / sum);
  }
  return map;
}

function mergeCandidates(
  sources: MatchSourceBundle[],
  weights: Map<string, number>
): ScoredDecisionMarket[] {
  const byId = new Map<string, ScoredDecisionMarket>();

  for (const source of sources) {
    const w = weights.get(source.pageId);
    if (w == null) continue;
    for (const m of source.markets) {
      const id = marketIdentity(m);
      const contribution = m.confidence * w;
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, {
          ...m,
          totalScore: contribution,
          contributingPages: [source.pageId],
        });
      } else {
        existing.totalScore += contribution;
        if (!existing.contributingPages.includes(source.pageId)) {
          existing.contributingPages.push(source.pageId);
        }
        // Prefer higher confidence for display
        if (m.confidence > existing.confidence) {
          existing.confidence = m.confidence;
          existing.label = m.label;
          existing.prediction = m.prediction;
          existing.pageId = m.pageId;
          existing.pageLabel = m.pageLabel;
        }
      }
    }
  }

  return [...byId.values()].sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Select exactly 3 markets with diversity:
 * at least one goals, one corners, one specialized when available.
 */
export function selectDiverseTopThree(
  scored: ScoredDecisionMarket[]
): ScoredDecisionMarket[] {
  const eligible = scored.filter((m) => m.confidence >= DECISION_MIN_CONFIDENCE);
  const pool = eligible.length > 0 ? eligible : scored;
  if (pool.length === 0) return [];

  const picked: ScoredDecisionMarket[] = [];
  const used = new Set<string>();

  const take = (m: ScoredDecisionMarket | undefined) => {
    if (!m) return;
    const id = marketIdentity(m);
    if (used.has(id)) return;
    used.add(id);
    picked.push(m);
  };

  const bestOf = (cat: ScoredDecisionMarket["category"]) =>
    pool.find((m) => m.category === cat && !used.has(marketIdentity(m)));

  take(bestOf("goals"));
  take(bestOf("corners"));
  take(bestOf("specialized"));

  for (const m of pool) {
    if (picked.length >= 3) break;
    take(m);
  }

  // Secondary: fill from full scored list (may be below threshold) to guarantee 3
  if (picked.length < 3) {
    for (const m of scored) {
      if (picked.length >= 3) break;
      take(m);
    }
  }

  return picked.slice(0, 3);
}

/**
 * Pad to exactly 3 when the system still has fewer distinct markets.
 * Uses placeholder markers only as last resort from the best available candidates
 * duplicated with a distinct synthetic key — preferred: return what we have and
 * let processBatch invent soft placeholders from match shell.
 */
export function ensureThreeMarkets(
  markets: ScoredDecisionMarket[],
  fallbacks: DecisionMarketCandidate[]
): ScoredDecisionMarket[] {
  const out = [...markets];
  const used = new Set(out.map(marketIdentity));

  for (const f of fallbacks) {
    if (out.length >= 3) break;
    const id = marketIdentity(f);
    if (used.has(id)) continue;
    used.add(id);
    out.push({
      ...f,
      totalScore: f.confidence * 0.01,
      contributingPages: [f.pageId],
    });
  }

  const padCategories = ["goals", "corners", "specialized"] as const;
  while (out.length < 3) {
    const category = padCategories[out.length] ?? "specialized";
    out.push({
      marketKey: `unavailable_${out.length}`,
      label: "Insufficient data",
      prediction: "—",
      confidence: 0,
      category,
      pageId: "system",
      pageLabel: "System",
      totalScore: 0,
      contributingPages: [],
    });
  }

  return out.slice(0, 3);
}

export function generateTopThreeMarkets(
  matchData: AggregatedMatchData,
  fallbacks: DecisionMarketCandidate[] = []
): {
  markets: ScoredDecisionMarket[];
  sourceCount: number;
  missingSources: string[];
  incomplete: boolean;
} {
  const weights = normalisedSourceWeights(matchData.sources);
  const scored = mergeCandidates(matchData.sources, weights);
  const diverse = selectDiverseTopThree(scored);
  const markets = ensureThreeMarkets(diverse, fallbacks);

  const okSources = matchData.sources.filter((s) => s.ok);
  const missingSources = matchData.sources
    .filter((s) => !s.ok)
    .map((s) => s.pageLabel);

  return {
    markets,
    sourceCount: okSources.length,
    missingSources,
    incomplete: okSources.length < DECISION_MIN_SOURCES,
  };
}
