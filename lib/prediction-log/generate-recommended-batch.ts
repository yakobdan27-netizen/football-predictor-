import { LOG_MARKET_MAP } from "./markets-config";
import { flattenScoredRows } from "./analysis";
import { oddsToBand, isValidOdds } from "./odds-bands";
import {
  computeFineOddsBuckets,
  detectWorstOddsBuckets,
} from "./odds-bucket-analysis";
import {
  buildRecommendationContext,
  getGlobalMarketRate,
  getMarketRate,
  getOddsBandRate,
  getTeamPickRate,
  isLowWinRate,
  type RecommendationContext,
} from "./recommendation-context";
import { computeAdjustedConfidence } from "./adjust-confidence";
import { computeMasterProbability, type MasterProbabilityResult } from "./master-probability";
import {
  MATCH_JUDGMENT_LABELS,
  ODDS_BAND_CEILINGS,
  RECO_ENGINE_VERSION,
  SIMILARITY_CAUTION_THRESHOLD,
  isHighVarianceMarket,
} from "./recommendation-config";
import { buildClubComparisonParagraph } from "./club-record-insights";
import { concentrationFromGrid } from "./correct-score-freeze";
import { bestLegForMatch, buildComboEntryCandidate, combinedOddsProduct, riskLevelFromCombinedOdds } from "./match-risk-score";
import { selectRecommendedMatches } from "./select-recommended-matches";
import {
  collectPriorOccupiedMarkets,
  filterCandidatesByOccupiedMarkets,
  formatSameDateDedupNotice,
  isSameDateDedupReason,
} from "./same-date-market-dedup";
import { isValueBet } from "./systematic-odds";
import type { ScoredMatchCandidate } from "./match-risk-score";
import type {
  AnalysisHistory,
  LogMarketKey,
  LogMatch,
  MarketPrediction,
  OddsBandId,
  PredictionBatch,
  RecommendedBatch,
  RecommendedMatch,
  RecommendedPick,
  RecommendationAction,
  RecommendationSettings,
  RecommendedBatchSummary,
  MatchGameListEntry,
  MatchJudgmentLabel,
  ClubProfilesStore,
  RecommendationTier,
} from "./types";
import type { ClubIndex, ClubRecord } from "./club-record-types";

const BAND_ORDER: OddsBandId[] = ["1.00-1.50", "1.51-2.00", "2.01-2.50", "2.51-3.00"];

function lowerOddsBand(band: OddsBandId): OddsBandId | null {
  const idx = BAND_ORDER.indexOf(band);
  return idx > 0 ? BAND_ORDER[idx - 1] : null;
}

function capOddsDown(original: number, ceiling?: number): number {
  const cap = ceiling ?? original;
  return Math.round(Math.min(original, cap) * 100) / 100;
}

function lowerLine(market: LogMarketKey, currentLine: number | undefined): number | null {
  const opts = LOG_MARKET_MAP[market]?.lineOptions;
  if (!opts || currentLine == null) return null;
  const idx = opts.indexOf(currentLine);
  if (idx > 0) return opts[idx - 1]!;
  return null;
}

function doubleChanceFrom1x2(prediction: string): string | null {
  if (prediction === "home") return "1x";
  if (prediction === "away") return "x2";
  if (prediction === "draw") return "1x";
  return null;
}

function clonePred(pred: MarketPrediction): MarketPrediction {
  return { ...pred, line: pred.line };
}

function makePick(
  pred: MarketPrediction,
  action: RecommendationAction,
  judgment: string,
  original?: MarketPrediction,
  confidenceBreakdown?: string
): RecommendedPick {
  return {
    ...pred,
    action,
    judgment,
    accepted: true,
    original: original ? clonePred(original) : undefined,
    confidenceBreakdown,
  };
}

function buildPickMathSnapshot(
  mp: MasterProbabilityResult,
  odds: number | null | undefined
): RecommendedPick["mathSnapshot"] {
  const grid = mp.statLayer?.scoreGrid;
  return {
    signals: {
      capacityEdge: Math.round(mp.signals.cap.value * 100),
      recentForm: Math.round(mp.signals.form.value * 100),
      headToHead: Math.round(mp.signals.h2h.value * 100),
      yourAccuracy: Math.round(mp.signals.you.value * 100),
      luckyNudge: Math.round(mp.signals.luck.value * 100),
      ...(mp.signals.lineup.reliability > 0
        ? { lineupContext: Math.round(mp.signals.lineup.value * 100) }
        : {}),
    },
    reliability: {
      capacityEdge: Number(mp.signals.cap.reliability.toFixed(2)),
      recentForm: Number(mp.signals.form.reliability.toFixed(2)),
      headToHead: Number(mp.signals.h2h.reliability.toFixed(2)),
      yourAccuracy: Number(mp.signals.you.reliability.toFixed(2)),
      luckyNudge: Number(mp.signals.luck.reliability.toFixed(2)),
      ...(mp.signals.lineup.reliability > 0
        ? { lineupContext: Number(mp.signals.lineup.reliability.toFixed(2)) }
        : {}),
    },
    pSignal: mp.pSignal,
    oddsUsed: odds ?? null,
    concentrationIndex: concentrationFromGrid(grid) ?? undefined,
    leagueAdjust: mp.leagueAdjust,
    statLayer: mp.statLayer,
  };
}

function finalizePick(
  pred: MarketPrediction,
  userOriginal: MarketPrediction,
  ctx: RecommendationContext,
  match: LogMatch,
  marketKey: LogMarketKey,
  action: RecommendationAction,
  baseJudgment: string
): RecommendedPick {
  const mp = computeMasterProbability(ctx, match, marketKey, pred);
  const confidence = mp.pSignal;
  const confNote =
    confidence !== userOriginal.confidence
      ? ` P_signal ${confidence}% (you entered ${userOriginal.confidence}%).`
      : ` P_signal ${confidence}%.`;
  const pick = makePick(
    { ...pred, confidence },
    action,
    `${baseJudgment}${confNote} ${mp.breakdown}`,
    userOriginal,
    mp.breakdown
  );
  pick.pSignal = mp.pSignal;
  pick.dataSampleSize = mp.dataSampleSize;
  pick.mathSnapshot = buildPickMathSnapshot(mp, pred.odds);
  return pick;
}

function applyLuckyNumbersToPick(
  pick: RecommendedPick,
  ctx: RecommendationContext,
  match: LogMatch,
  marketKey: LogMarketKey,
  luckyNumbers: number[]
): void {
  if (!luckyNumbers.length) return;
  const mp = computeMasterProbability(ctx, match, marketKey, pick, luckyNumbers);
  if (mp.pSignal !== pick.pSignal) {
    pick.pSignal = mp.pSignal;
    pick.confidence = mp.pSignal;
    pick.dataSampleSize = mp.dataSampleSize;
    pick.confidenceBreakdown = mp.breakdown;
    pick.mathSnapshot = buildPickMathSnapshot(mp, pick.odds);
  }
}

export function recommendPick(
  ctx: RecommendationContext,
  match: LogMatch,
  marketKey: LogMarketKey,
  original: MarketPrediction
): { pick: RecommendedPick | null; alternative?: { key: LogMarketKey; pick: RecommendedPick } } {
  const odds = original.odds;
  const league = ctx.league;
  const marketRate = getMarketRate(ctx, league, marketKey);
  const globalMarketRate = getGlobalMarketRate(ctx, marketKey);
  const effectiveMarketRate = !marketRate.lowSample ? marketRate : globalMarketRate;

  const coldStartNote = !ctx.hasHistory
    ? "Insufficient history — systematic rules only."
    : "";

  // Value-bet gate
  if (odds != null && isValidOdds(odds) && !isValueBet(original.confidence, odds)) {
    const preview = computeAdjustedConfidence(ctx, match, marketKey, original, original);
    if (preview.adjusted < original.confidence * 0.7) {
      return {
        pick: finalizePick(
          original,
          original,
          ctx,
          match,
          marketKey,
          "remove",
          `Confidence ${original.confidence}% does not clear the 8% value margin over implied probability — removed.${coldStartNote ? ` ${coldStartNote}` : ""}`
        ),
      };
    }
    return {
      pick: finalizePick(
        original,
        original,
        ctx,
        match,
        marketKey,
        "revise",
        `Below 8% value margin — confidence adjusted.${coldStartNote ? ` ${coldStartNote}` : ""}`
      ),
    };
  }

  // Odds band risk
  if (odds != null && isValidOdds(odds)) {
    const band = oddsToBand(odds);
    const bandRate = getOddsBandRate(ctx, band);
    if (isLowWinRate(bandRate, marketKey) && !bandRate.lowSample) {
      const lowerBand = lowerOddsBand(band);
      if (lowerBand) {
        const newOdds = capOddsDown(odds, ODDS_BAND_CEILINGS[lowerBand]);
        return {
          pick: finalizePick(
            original,
            original,
            ctx,
            match,
            marketKey,
            "revise",
            `Odds band ${band} has only ${bandRate.pct}% success in your history — odds capped to ${newOdds}.`
          ),
        };
      }
      return {
        pick: finalizePick(
          original,
          original,
          ctx,
          match,
          marketKey,
          "remove",
          `Odds band ${band} has only ${bandRate.pct}% success in your history — pick removed.`
        ),
      };
    }
  }

  // High-variance markets
  if (isHighVarianceMarket(marketKey) && isLowWinRate(effectiveMarketRate, marketKey)) {
    return {
      pick: finalizePick(
        original,
        original,
        ctx,
        match,
        marketKey,
        "remove",
        `${LOG_MARKET_MAP[marketKey]?.label ?? marketKey} is high-variance and your win rate is ${effectiveMarketRate.pct}% — removed.`
      ),
    };
  }

  // Market + league risk
  if (isLowWinRate(effectiveMarketRate, marketKey)) {
    // Try categorical revision
    if (marketKey === "1x2" || marketKey === "ht_1x2") {
      const dc = doubleChanceFrom1x2(original.prediction);
      if (dc) {
        const altOdds =
          odds != null && isValidOdds(odds)
            ? capOddsDown(odds, ODDS_BAND_CEILINGS["1.51-2.00"])
            : odds;
        return {
          pick: finalizePick(
            original,
            original,
            ctx,
            match,
            marketKey,
            "remove",
            `${marketKey === "1x2" ? "Match result" : "First half result"} has ${effectiveMarketRate.pct}% success in ${league} — replaced with safer double chance.`
          ),
          alternative: {
            key: "double_chance",
            pick: finalizePick(
              { prediction: dc, odds: altOdds, confidence: original.confidence },
              original,
              ctx,
              match,
              "double_chance",
              "add_alternative",
              `Safer double chance (${dc.toUpperCase()}) based on weak straight result history.`
            ),
          },
        };
      }
    }

    if (marketKey === "btts" && original.prediction === "yes") {
      return {
        pick: finalizePick(
          {
            ...original,
            prediction: "no",
            odds: odds != null && isValidOdds(odds) ? capOddsDown(odds) : odds,
          },
          original,
          ctx,
          match,
          marketKey,
          "revise",
          `BTTS Yes underperforms at ${effectiveMarketRate.pct}% in your history — switched to No.`
        ),
      };
    }

    // Numeric O/U revision
    const def = LOG_MARKET_MAP[marketKey];
    if (def?.kind === "numeric" && original.prediction === "over") {
      const lower = lowerLine(marketKey, original.line);
      if (lower != null) {
        return {
          pick: finalizePick(
            {
              ...original,
              line: lower,
              odds: odds != null && isValidOdds(odds) ? capOddsDown(odds) : odds,
            },
            original,
            ctx,
            match,
            marketKey,
            "revise",
            `${def.label} Over has ${effectiveMarketRate.pct}% success — safer over line ${lower}.`
          ),
        };
      }
      return {
        pick: finalizePick(
          {
            ...original,
            prediction: "under",
            odds: odds != null && isValidOdds(odds) ? capOddsDown(odds) : odds,
          },
          original,
          ctx,
          match,
          marketKey,
          "revise",
          `${def.label} Over underperforms — switched to Under ${original.line ?? "?"}.`
        ),
      };
    }

    return {
      pick: finalizePick(
        original,
        original,
        ctx,
        match,
        marketKey,
        "remove",
        `${LOG_MARKET_MAP[marketKey]?.label ?? marketKey} has ${effectiveMarketRate.pct}% success in ${league} — removed.`
      ),
    };
  }

  // Team pick contradiction
  const teamRate = getTeamPickRate(
    ctx,
    match.homeTeam,
    match.awayTeam,
    marketKey,
    original.prediction
  );
  if (!teamRate.lowSample && teamRate.pct != null && teamRate.pct < 40) {
    return {
      pick: finalizePick(
        original,
        original,
        ctx,
        match,
        marketKey,
        "revise",
        `This pick direction for these teams has only ${teamRate.pct}% success — confidence adjusted.`
      ),
    };
  }

  const baseJudgment = coldStartNote
    ? coldStartNote
    : "Passes historical and value checks — kept as entered.";

  return {
    pick: finalizePick(
      {
        ...original,
        odds: odds != null && isValidOdds(odds) ? capOddsDown(odds) : odds,
      },
      original,
      ctx,
      match,
      marketKey,
      "keep",
      baseJudgment
    ),
  };
}

function assignMatchJudgment(
  candidate: ScoredMatchCandidate,
  selected: boolean
): { judgment: MatchJudgmentLabel; judgmentText: string } {
  if (!selected || !candidate.passesHardFilters) {
    return { judgment: "skip", judgmentText: MATCH_JUDGMENT_LABELS.skip };
  }
  if (candidate.similarityScore >= SIMILARITY_CAUTION_THRESHOLD) {
    return { judgment: "strong_keep", judgmentText: MATCH_JUDGMENT_LABELS.strong_keep };
  }
  return { judgment: "keep_caution", judgmentText: MATCH_JUDGMENT_LABELS.keep_caution };
}

function buildGameList(
  allMatches: LogMatch[],
  candidates: ScoredMatchCandidate[],
  selected: ScoredMatchCandidate[],
  excluded: ScoredMatchCandidate[]
): MatchGameListEntry[] {
  const candidateById = new Map(candidates.map((c) => [c.matchId, c]));
  const selectedIds = new Set(selected.map((c) => c.matchId));
  const excludedById = new Map(excluded.map((c) => [c.matchId, c]));

  return allMatches.map((match) => {
    const candidate = candidateById.get(match.id);
    if (!candidate) {
      return {
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        similarityScore: 0,
        combinedScore: 0,
        judgment: "skip" as MatchJudgmentLabel,
        judgmentText: MATCH_JUDGMENT_LABELS.skip,
        selected: false,
        legOdds: null,
        evidence: [],
        skipReason: "No valid pick after revision.",
      };
    }

    const isSelected = selectedIds.has(match.id);
    const { judgment, judgmentText } = assignMatchJudgment(candidate, isSelected);
    const excludedEntry = excludedById.get(match.id);

    return {
      matchId: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      similarityScore: candidate.similarityScore,
      combinedScore: candidate.combinedScore,
      judgment,
      judgmentText,
      selected: isSelected,
      legOdds: candidate.legOdds,
      evidence: candidate.evidence,
      skipReason: isSelected ? undefined : (excludedEntry?.exclusionReason ?? candidate.exclusionReason ?? undefined),
    };
  });
}

export interface RecommendationArtifacts {
  ctx: RecommendationContext;
  candidates: ScoredMatchCandidate[];
  allLegCandidates: ScoredMatchCandidate[];
  original: PredictionBatch;
}

export function buildRecommendationArtifacts(
  original: PredictionBatch,
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  settings: RecommendationSettings,
  clubProfiles: ClubProfilesStore | null = null,
  clubRecords: Record<string, ClubRecord> | null = null,
  clubIndex: ClubIndex | null = null,
  luckyNumbers: number[] = [],
  statExtras?: {
    leagueBaselines?: import("./league-baselines").LeagueBaselinesStore | null;
    mlClassifier?: import("./ml-model-store").MlClassifierStore | null;
    teamsQuality?: import("./teams-quality-types").TeamsQualityStore | null;
    leagueProfiles?: import("./types").LeagueProfilesStore | null;
  }
): RecommendationArtifacts {
  const recordsMap = clubRecords;
  const ctx = buildRecommendationContext(
    original,
    allBatches,
    analysis,
    clubProfiles,
    recordsMap,
    clubIndex,
    statExtras
  );
  const historyRows = flattenScoredRows(allBatches.filter((b) => b.id !== original.id));
  const fineBuckets = computeFineOddsBuckets(historyRows);
  const worstBuckets = detectWorstOddsBuckets(fineBuckets);

  const revisedByMatch = new Map<
    string,
    { match: LogMatch; predictions: Partial<Record<LogMarketKey, RecommendedPick>> }
  >();

  for (const match of original.matches) {
    const predictions: Partial<Record<LogMarketKey, RecommendedPick>> = {};

    if (match.marketMode === "combined" && match.comboPick?.comboId) {
      revisedByMatch.set(match.id, { match, predictions });
      continue;
    }

    for (const [key, pred] of Object.entries(match.predictions) as [
      LogMarketKey,
      MarketPrediction,
    ][]) {
      const result = recommendPick(ctx, match, key, pred);
      if (result.pick) {
        applyLuckyNumbersToPick(result.pick, ctx, match, key, luckyNumbers);
        predictions[key] = result.pick;
      }
      if (result.alternative && !predictions[result.alternative.key]) {
        predictions[result.alternative.key] = result.alternative.pick;
      }
    }

    revisedByMatch.set(match.id, { match, predictions });
  }

  const candidates: ScoredMatchCandidate[] = [];
  const allLegCandidates: ScoredMatchCandidate[] = [];
  for (const { match, predictions } of revisedByMatch.values()) {
    if (match.marketMode === "combined" && match.comboPick?.comboId) {
      const comboLeg = buildComboEntryCandidate(match);
      if (comboLeg) {
        candidates.push(comboLeg);
        allLegCandidates.push(comboLeg);
      }
      continue;
    }

    for (const [key, pick] of Object.entries(predictions) as [LogMarketKey, RecommendedPick][]) {
      if (!pick || pick.action === "remove") continue;
      allLegCandidates.push(
        bestLegForMatch(
          match,
          { [key]: pick },
          ctx,
          original.league,
          settings,
          fineBuckets,
          worstBuckets
        )!
      );
    }
    const leg = bestLegForMatch(
      match,
      predictions,
      ctx,
      original.league,
      settings,
      fineBuckets,
      worstBuckets
    );
    if (leg) candidates.push(leg);
  }

  return { ctx, candidates, allLegCandidates, original };
}

export function buildRecommendedBatchFromSelection(
  original: PredictionBatch,
  ctx: RecommendationContext,
  candidates: ScoredMatchCandidate[],
  selection: ReturnType<typeof selectRecommendedMatches>,
  displayName: string,
  tier?: RecommendationTier
): RecommendedBatch | null {
  const gameList = buildGameList(original.matches, candidates, selection.selected, selection.excluded);

  if (selection.selected.length === 0) return null;

  const recommendedMatches: RecommendedMatch[] = selection.selected.map((leg) => ({
    id: leg.matchId,
    homeTeam: leg.homeTeam,
    awayTeam: leg.awayTeam,
    predictions: { [leg.marketKey]: leg.pick },
  }));

  const summary = buildSummary(original, selection, ctx);

  return {
    displayName,
    generatedAt: new Date().toISOString(),
    engineVersion: RECO_ENGINE_VERSION,
    tier,
    matches: recommendedMatches,
    acceptAll: false,
    summary,
    gameList,
  };
}

export function generateRecommendedBatch(
  original: PredictionBatch,
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  settings: RecommendationSettings,
  clubProfiles: ClubProfilesStore | null = null,
  clubRecords: Record<string, ClubRecord> | null = null,
  clubIndex: ClubIndex | null = null,
  luckyNumbers: number[] = [],
  statExtras?: {
    leagueBaselines?: import("./league-baselines").LeagueBaselinesStore | null;
    mlClassifier?: import("./ml-model-store").MlClassifierStore | null;
    teamsQuality?: import("./teams-quality-types").TeamsQualityStore | null;
    leagueProfiles?: import("./types").LeagueProfilesStore | null;
  }
): RecommendedBatch | null {
  const artifacts = buildRecommendationArtifacts(
    original,
    allBatches,
    analysis,
    settings,
    clubProfiles,
    clubRecords,
    clubIndex,
    luckyNumbers,
    statExtras
  );

  const priorOccupied = collectPriorOccupiedMarkets(original, allBatches);
  const rawSelection = selectRecommendedMatches(artifacts.candidates, settings);
  const dedupSourceLabel =
    priorOccupied.batchNames.length > 0
      ? priorOccupied.batchNames.join(", ")
      : "an earlier batch";
  let { eligible, removed } = filterCandidatesByOccupiedMarkets(
    rawSelection.selected,
    priorOccupied.keys,
    dedupSourceLabel
  );

  if (eligible.length === 0 && rawSelection.selected.length > 0) {
    const fallback = filterCandidatesByOccupiedMarkets(
      artifacts.candidates.filter((candidate) => candidate.passesHardFilters),
      priorOccupied.keys,
      dedupSourceLabel
    );
    eligible = fallback.eligible;
    removed = [
      ...removed,
      ...rawSelection.selected,
      ...fallback.removed.filter(
        (candidate) =>
          !removed.some(
            (entry) =>
              entry.matchId === candidate.matchId && entry.marketKey === candidate.marketKey
          )
      ),
    ];
  }

  const selection = {
    selected: eligible,
    excluded: [...rawSelection.excluded, ...removed],
    totalCombinedOdds:
      eligible.length > 0
        ? Math.round(combinedOddsProduct(eligible) * 100) / 100
        : rawSelection.totalCombinedOdds,
  };

  const recommended = buildRecommendedBatchFromSelection(
    original,
    artifacts.ctx,
    artifacts.candidates,
    selection,
    `${original.batchName} – Recommended`
  );

  if (!recommended || removed.length === 0) {
    return recommended;
  }

  const notice = formatSameDateDedupNotice(removed.length, priorOccupied.batchNames);
  const dedupExclusions = removed.map((candidate) => ({
    matchId: candidate.matchId,
    homeTeam: candidate.homeTeam,
    awayTeam: candidate.awayTeam,
    reason: candidate.exclusionReason ?? notice,
  }));

  return {
    ...recommended,
    summary: {
      ...recommended.summary,
      summaryJudgment: `${recommended.summary.summaryJudgment} ${notice}`,
      exclusions: [...recommended.summary.exclusions, ...dedupExclusions],
    },
    gameList: recommended.gameList.map((entry) => {
      const removedEntry = removed.find((candidate) => candidate.matchId === entry.matchId);
      if (!removedEntry || entry.selected) return entry;
      return {
        ...entry,
        skipReason: removedEntry.exclusionReason ?? entry.skipReason,
      };
    }),
  };
}

function buildSummary(
  original: PredictionBatch,
  selection: ReturnType<typeof selectRecommendedMatches>,
  ctx: RecommendationContext
): RecommendedBatchSummary {
  const riskLevel = selection.totalCombinedOdds
    ? riskLevelFromCombinedOdds(selection.totalCombinedOdds)
    : "high";

  const exclusions = selection.excluded.map((c) => ({
    matchId: c.matchId,
    homeTeam: c.homeTeam,
    awayTeam: c.awayTeam,
    reason: c.exclusionReason ?? "Excluded from recommended slip.",
  }));

  const oddsFilterFails = selection.excluded.filter((c) =>
    c.exclusionReason?.includes("outside safe range")
  ).length;
  const marketFails = selection.excluded.filter((c) =>
    c.exclusionReason?.includes("Market win rate")
  ).length;
  const dedupFails = selection.excluded.filter((c) =>
    isSameDateDedupReason(c.exclusionReason)
  ).length;
  const otherFails = selection.excluded.length - oddsFilterFails - marketFails - dedupFails;

  const parts: string[] = [];
  if (oddsFilterFails > 0) parts.push(`${oddsFilterFails} failed odds filter`);
  if (marketFails > 0) parts.push(`${marketFails} weak market history`);
  if (dedupFails > 0) parts.push(`${dedupFails} same-date duplicate`);
  if (otherFails > 0) parts.push(`${otherFails} other`);

  const riskLabel = riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1);
  let judgment = `${selection.selected.length} of ${original.matches.length} matches selected — review batch risk on Recommendation.`;
  if (selection.totalCombinedOdds != null) {
    judgment += ` Combined odds ${selection.totalCombinedOdds} (${riskLabel} risk).`;
  }
  if (selection.excluded.length > 0) {
    judgment += ` ${selection.excluded.length} excluded${parts.length ? `: ${parts.join(", ")}` : ""}.`;
  }

  const clubInsight = buildClubComparisonParagraph(ctx, selection.selected);

  return {
    totalCombinedOdds: selection.totalCombinedOdds,
    riskLevel,
    matchesIncluded: selection.selected.length,
    matchesDropped: original.matches.length - selection.selected.length,
    summaryJudgment: judgment,
    clubInsight,
    exclusions,
  };
}

export function countRecommendationChanges(batch: PredictionBatch): number {
  if (!batch.recommended) return 0;
  let changes = 0;
  for (const rm of batch.recommended.matches) {
    const orig = batch.matches.find((m) => m.id === rm.id);
    if (!orig) continue;
    for (const [key, rp] of Object.entries(rm.predictions) as [LogMarketKey, RecommendedPick][]) {
      if (rp.action !== "keep") {
        changes++;
        continue;
      }
      const op = orig.predictions[key];
      if (
        op &&
        (op.prediction !== rp.prediction ||
          op.line !== rp.line ||
          op.confidence !== rp.confidence ||
          op.odds !== rp.odds)
      ) {
        changes++;
      }
    }
  }
  return changes;
}
