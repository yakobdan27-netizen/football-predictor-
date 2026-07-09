import {
  buildRecommendationArtifacts,
  buildRecommendedBatchFromSelection,
  type RecommendationArtifacts,
} from "./generate-recommended-batch";
import { overlayLearnerOnBatch } from "./learner-recommendations";
import {
  AGGRESSIVE_TIER_MIN_PFINAL,
  BALANCED_TIER_MIN_PFINAL,
  RECO_ENGINE_VERSION,
  SAFE_TIER_MAX_MATCHES,
  SAFE_TIER_MAX_RISK,
} from "./recommendation-config";
import { computeBatchRisk, activeLegsFromRecommended } from "./dynamic-batch-risk";
import { compareWeakestByConcentration } from "./correct-score";
import { attachCorrectScoreToBatch } from "./correct-score-freeze";
import { passesBayesianIntervalGate } from "./bayesian-tier";
import { FORMULA_CONFIG, confidenceBand } from "./master-probability-config";
import type { ClubIndex, ClubRecord } from "./club-record-types";
import type { ScoredMatchCandidate } from "./match-risk-score";
import type { MatchSelectionResult } from "./select-recommended-matches";
import {
  batchMatchDay,
  collectPriorOccupiedMarkets,
  filterCandidatesByOccupiedMarkets,
  formatSameDateDedupNotice,
  occupiedFromCandidates,
} from "./same-date-market-dedup";
import { resolveLeagueCharacterProfile } from "./league-profiles";
import type {
  AnalysisHistory,
  ClubProfilesStore,
  LearnerStatsStore,
  LeagueCharacterProfile,
  LogMatch,
  PredictionBatch,
  RecommendationSettings,
  RecommendedBatch,
  RecommendedMatch,
  RecommendationTier,
  TeamCharacteristicsStore,
} from "./types";
import type { TeamsQualityStore } from "./teams-quality-types";
import {
  buildExtendedMathSnapshot,
  type TierFreezeMetadata,
} from "./freeze-batch-snapshot";

const CORE_MARKETS = new Set(["1x2", "double_chance", "btts", "home_goals_ou", "away_goals_ou"]);

const TIER_META: Record<
  RecommendationTier,
  { label: string; batchLabel: string; suffix: string }
> = {
  safe: {
    label: "EXTREMELY SAFE – Minimal Risk",
    batchLabel: "Extremely Safe",
    suffix: "SAFE",
  },
  balanced: {
    label: "RECOMMENDED – Balanced & Reliable",
    batchLabel: "Recommended",
    suffix: "BAL",
  },
  aggressive: {
    label: "AGGRESSIVE – Best Alternative Markets",
    batchLabel: "Aggressive",
    suffix: "AGG",
  },
};

export interface TieredRecommendationResult {
  sourceBatch: PredictionBatch;
  tiers: PredictionBatch[];
}

function sortByStrength(a: ScoredMatchCandidate, b: ScoredMatchCandidate): number {
  const aScore = a.pick.pSignal ?? a.combinedScore;
  const bScore = b.pick.pSignal ?? b.combinedScore;
  return bScore - aScore || b.combinedScore - a.combinedScore || b.riskAdjustedScore - a.riskAdjustedScore;
}

function marketIsCore(candidate: ScoredMatchCandidate): boolean {
  return CORE_MARKETS.has(candidate.marketKey);
}

function signalAgreement(candidate: ScoredMatchCandidate): number {
  const signals = candidate.pick.mathSnapshot?.signals;
  if (!signals) return 0;
  return Object.values(signals).filter((value) => value >= 55).length;
}

function isAlternativeCandidate(candidate: ScoredMatchCandidate): boolean {
  const original = candidate.pick.original;
  return (
    candidate.pick.action === "add_alternative" ||
    (original != null &&
      (candidate.pick.prediction !== original.prediction || candidate.pick.line !== original.line))
  );
}

function groupBestCandidatesByMatch(
  allLegCandidates: ScoredMatchCandidate[],
  allowAlternativeMarkets: boolean
): ScoredMatchCandidate[] {
  const grouped = new Map<string, ScoredMatchCandidate[]>();
  for (const candidate of allLegCandidates) {
    const list = grouped.get(candidate.matchId) ?? [];
    list.push(candidate);
    grouped.set(candidate.matchId, list);
  }

  const best: ScoredMatchCandidate[] = [];
  for (const group of grouped.values()) {
    const allowed = allowAlternativeMarkets
      ? group
      : group.filter((candidate) => !isAlternativeCandidate(candidate));
    const pool = allowAlternativeMarkets ? allowed : allowed.length > 0 ? allowed : [];
    const sorted = [...pool].sort(sortByStrength);
    if (sorted[0]) best.push(sorted[0]);
  }
  return best;
}

function selectionFromCandidates(
  selected: ScoredMatchCandidate[],
  allCandidates: ScoredMatchCandidate[],
  extraExcluded: ScoredMatchCandidate[] = []
): MatchSelectionResult {
  const selectedIds = new Set(selected.map((candidate) => candidate.matchId));
  const excludedFromPool = allCandidates
    .filter((candidate) => !selectedIds.has(candidate.matchId))
    .map((candidate) => ({
      ...candidate,
      exclusionReason: candidate.exclusionReason ?? "Excluded from this recommendation tier.",
    }));

  const excluded = [
    ...excludedFromPool,
    ...extraExcluded.filter(
      (candidate) =>
        !excludedFromPool.some(
          (entry) => entry.matchId === candidate.matchId && entry.marketKey === candidate.marketKey
        )
    ),
  ];

  const totalCombinedOdds =
    selected.length > 0
      ? Math.round(selected.reduce((product, candidate) => product * candidate.legOdds, 1) * 100) / 100
      : null;

  return { selected, excluded, totalCombinedOdds };
}

function selectionRisk(
  selected: ScoredMatchCandidate[],
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  teamsQuality?: TeamsQualityStore | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
) {
  return computeBatchRisk(
    selected.map((candidate) => ({
      matchId: candidate.matchId,
      homeTeam: candidate.homeTeam,
      awayTeam: candidate.awayTeam,
      marketKey: candidate.marketKey,
      odds: candidate.legOdds,
      pSignal: candidate.pick.pSignal,
      prediction: candidate.pick.prediction,
      concentrationIndex: candidate.concentrationIndex,
    })),
    { batches: allBatches, analysis, teamsQuality, leagueCharacterProfile }
  );
}

function weakestCandidate(selected: ScoredMatchCandidate[], pFinalByMatch: Record<string, number>) {
  return [...selected].sort((a, b) => {
    const aFinal = pFinalByMatch[a.matchId] ?? a.pick.pSignal ?? 50;
    const bFinal = pFinalByMatch[b.matchId] ?? b.pick.pSignal ?? 50;
    const aConc = a.concentrationIndex ?? 50;
    const bConc = b.concentrationIndex ?? 50;
    return (
      compareWeakestByConcentration(aFinal, bFinal, aConc, bConc) ||
      (a.pick.pSignal ?? 50) - (b.pick.pSignal ?? 50)
    );
  })[0];
}

function trimByConstraints(
  selected: ScoredMatchCandidate[],
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  maxRisk: number,
  minBatchConfidence: number,
  teamsQuality?: TeamsQualityStore | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): { selected: ScoredMatchCandidate[]; removed: ScoredMatchCandidate[] } {
  let remaining = [...selected];
  const removed: ScoredMatchCandidate[] = [];
  while (remaining.length > 1) {
    const risk = selectionRisk(remaining, allBatches, analysis, teamsQuality, leagueCharacterProfile);
    if (
      risk.rBatch <= maxRisk &&
      (risk.batchConfidence == null || risk.batchConfidence >= minBatchConfidence)
    ) {
      break;
    }

    const weakest = weakestCandidate(remaining, risk.pFinalByMatch);
    if (!weakest) break;
    removed.push(weakest);
    remaining = remaining.filter((candidate) => candidate.matchId !== weakest.matchId);
  }
  return { selected: remaining, removed };
}

function selectSafeCandidates(
  pool: ScoredMatchCandidate[],
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  minPFinal: number,
  teamsQuality?: TeamsQualityStore | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): { selected: ScoredMatchCandidate[]; removed: ScoredMatchCandidate[] } {
  const sorted = [...pool].sort((a, b) => {
    const agreementDelta = signalAgreement(b) - signalAgreement(a);
    return agreementDelta || sortByStrength(a, b);
  });
  if (sorted.length === 0) return { selected: [], removed: [] };

  const selected: ScoredMatchCandidate[] = [sorted[0]!];
  for (const candidate of sorted.slice(1, SAFE_TIER_MAX_MATCHES + 2)) {
    if (selected.length >= SAFE_TIER_MAX_MATCHES) break;
    if (
      !passesBayesianIntervalGate(
        "safe",
        candidate.pick.mathSnapshot?.statLayer?.bayesianLayer?.intervalWidth
      )
    ) {
      continue;
    }
    const next = [...selected, candidate];
    const risk = selectionRisk(next, allBatches, analysis, teamsQuality, leagueCharacterProfile);
    if (
      risk.rBatch <= SAFE_TIER_MAX_RISK &&
      (risk.batchConfidence == null || risk.batchConfidence >= minPFinal)
    ) {
      selected.push(candidate);
    }
  }
  return trimByConstraints(
    selected,
    allBatches,
    analysis,
    SAFE_TIER_MAX_RISK,
    minPFinal,
    teamsQuality,
    leagueCharacterProfile
  );
}

function pickSourceMatch(sourceBatch: PredictionBatch, matchId: string): LogMatch {
  const match = sourceBatch.matches.find((entry) => entry.id === matchId);
  if (!match) {
    throw new Error(`Missing source match ${matchId}`);
  }
  return match;
}

function materializeBatchMatches(
  sourceBatch: PredictionBatch,
  recommended: RecommendedBatch
): LogMatch[] {
  return recommended.matches.map((recommendedMatch) => {
    const sourceMatch = pickSourceMatch(sourceBatch, recommendedMatch.id);
    const pickEntries = Object.entries(recommendedMatch.predictions).filter(
      ([, pick]) => pick && pick.action !== "remove"
    );

    return {
      ...sourceMatch,
      predictions: Object.fromEntries(
        pickEntries.map(([key, pick]) => [
          key,
          {
            prediction: pick!.prediction,
            line: pick!.line,
            confidence: pick!.confidence,
            odds: pick!.odds,
          },
        ])
      ),
      actualResults: {},
      scored: {},
      recommendedScored: {},
    };
  });
}

function nextRecommendationBaseId(existingBatches: PredictionBatch[], generatedAt: Date): string {
  const day = generatedAt.toISOString().slice(0, 10).replace(/-/g, "");
  const pattern = new RegExp(`^REC-${day}-(\\d{3})(?:-(SAFE|BAL|AGG))?$`);
  let maxSeq = 0;

  for (const batch of existingBatches) {
    const rawId = batch.recommendationId ?? batch.id;
    const match = pattern.exec(rawId);
    if (!match) continue;
    maxSeq = Math.max(maxSeq, Number(match[1]));
  }

  return `REC-${day}-${String(maxSeq + 1).padStart(3, "0")}`;
}

function freezeRecommendedBatch(
  batch: PredictionBatch,
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  settings: RecommendationSettings,
  learnerEnabled: boolean,
  luckyNumbers: number[],
  metadata: TierFreezeMetadata,
  teamsQuality?: TeamsQualityStore | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): PredictionBatch {
  if (!batch.recommended) return batch;

  const risk = computeBatchRisk(activeLegsFromRecommended(batch), {
    batches: allBatches,
    analysis,
    teamsQuality,
    leagueCharacterProfile,
  });

  const matches: RecommendedMatch[] = batch.recommended.matches.map((match) => {
    const predictions = Object.fromEntries(
      Object.entries(match.predictions).map(([key, pick]) => {
        if (!pick || pick.action === "remove") return [key, pick];
        const pFinal = risk.pFinalByMatch[match.id];
        return [
          key,
          {
            ...pick,
            pFinal,
            confidenceBand: pFinal != null ? confidenceBand(pFinal) : pick.confidenceBand,
          },
        ];
      })
    ) as RecommendedMatch["predictions"];

    return { ...match, predictions };
  });

  const mathSnapshot = buildExtendedMathSnapshot(
    batch,
    { ...batch.recommended, matches },
    allBatches,
    analysis,
    settings,
    learnerEnabled,
    luckyNumbers,
    risk,
    metadata,
    teamsQuality,
    leagueCharacterProfile
  );

  return {
    ...batch,
    recommended: {
      ...batch.recommended,
      matches,
      summary: {
        ...batch.recommended.summary,
        averagePFinal: risk.batchConfidence,
      },
      mathSnapshot,
    },
  };
}

function createTierBatch(
  sourceBatch: PredictionBatch,
  recommended: RecommendedBatch,
  tier: RecommendationTier,
  recommendationBaseId: string,
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  settings: RecommendationSettings,
  learnerEnabled: boolean,
  luckyNumbers: number[],
  metadata: TierFreezeMetadata,
  teamsQuality?: TeamsQualityStore | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): PredictionBatch {
  const generatedAt = new Date().toISOString();
  const recommendationId = `${recommendationBaseId}-${TIER_META[tier].suffix}`;

  const batch: PredictionBatch = {
    id: recommendationId,
    recommendationId,
    batchKind: "recommended",
    sourceBatchId: sourceBatch.id,
    recommendationTier: tier,
    recommendationStatus: "PENDING",
    date: batchMatchDay(sourceBatch, allBatches),
    league: sourceBatch.league,
    batchName: `${sourceBatch.batchName} – ${TIER_META[tier].batchLabel}`,
    createdAt: generatedAt,
    matches: materializeBatchMatches(sourceBatch, recommended),
    recommended: {
      ...recommended,
      displayName: TIER_META[tier].label,
      tier,
      generatedAt,
      engineVersion: RECO_ENGINE_VERSION,
    },
  };

  return attachCorrectScoreToBatch(
    freezeRecommendedBatch(
      batch,
      allBatches,
      analysis,
      settings,
      learnerEnabled,
      luckyNumbers,
      metadata,
      teamsQuality,
      leagueCharacterProfile
    )
  );
}

function ensureNonEmpty(pool: ScoredMatchCandidate[]): ScoredMatchCandidate[] {
  return pool.length > 0 ? pool : [];
}

function selectTierCandidates(
  tier: RecommendationTier,
  artifacts: RecommendationArtifacts,
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  settings: RecommendationSettings,
  teamsQuality?: TeamsQualityStore | null,
  leagueCharacterProfile?: LeagueCharacterProfile | null
): { selected: ScoredMatchCandidate[]; trimRemoved: ScoredMatchCandidate[] } {
  if (tier === "safe") {
    const corePool = artifacts.candidates.filter((candidate) => marketIsCore(candidate));
    const pool = ensureNonEmpty(corePool.length > 0 ? corePool : artifacts.candidates);
    const { selected, removed } = selectSafeCandidates(
      pool,
      allBatches,
      analysis,
      settings.tier1MinPFinal,
      teamsQuality,
      leagueCharacterProfile
    );
    return {
      selected: selected.length > 0 ? selected : pool.slice(0, 1),
      trimRemoved: removed,
    };
  }

  if (tier === "aggressive") {
    const pool = groupBestCandidatesByMatch(
      artifacts.allLegCandidates,
      settings.tier3AllowAlternativeMarkets
    )
      .filter((candidate) => candidate.passesHardFilters)
      .sort(sortByStrength);
    const fallbackPool =
      pool.length > 0
        ? pool
        : [...artifacts.candidates].filter((candidate) => candidate.passesHardFilters).sort(sortByStrength);
    const { selected, removed } = trimByConstraints(
      fallbackPool,
      allBatches,
      analysis,
      settings.tier3MaxBatchRisk,
      AGGRESSIVE_TIER_MIN_PFINAL,
      teamsQuality,
      leagueCharacterProfile
    );
    return {
      selected: selected.length > 0 ? selected : fallbackPool.slice(0, 1),
      trimRemoved: removed,
    };
  }

  const pool = [...artifacts.candidates]
    .filter((candidate) => candidate.passesHardFilters)
    .filter((candidate) =>
      passesBayesianIntervalGate("balanced", candidate.pick.mathSnapshot?.statLayer?.bayesianLayer?.intervalWidth)
    );
  const balancedPool = pool.length > 0 ? pool : [...artifacts.candidates].filter((c) => c.passesHardFilters);
  const { selected, removed } = trimByConstraints(
    balancedPool.sort(sortByStrength),
    allBatches,
    analysis,
    FORMULA_CONFIG.riskCeiling,
    BALANCED_TIER_MIN_PFINAL,
    teamsQuality,
    leagueCharacterProfile
  );
  return {
    selected: selected.length > 0 ? selected : balancedPool.slice(0, 1),
    trimRemoved: removed,
  };
}

function maybeOverlayLearner(
  recommended: RecommendedBatch,
  sourceBatch: PredictionBatch,
  learnerEnabled: boolean,
  learnerStats: LearnerStatsStore,
  settings: RecommendationSettings,
  teamCharacteristics: TeamCharacteristicsStore | null
): RecommendedBatch {
  if (!learnerEnabled) return recommended;
  const overlaid = overlayLearnerOnBatch(
    recommended,
    sourceBatch,
    learnerStats,
    settings,
    teamCharacteristics
  );
  return {
    ...overlaid,
    displayName: recommended.displayName,
    tier: recommended.tier,
  };
}

export function generateTieredRecommendationBatches(
  sourceBatch: PredictionBatch,
  allBatches: PredictionBatch[],
  analysis: AnalysisHistory,
  settings: RecommendationSettings,
  learnerEnabled: boolean,
  learnerStats: LearnerStatsStore,
  teamCharacteristics: TeamCharacteristicsStore | null,
  clubProfiles: ClubProfilesStore | null,
  clubRecords: Record<string, ClubRecord> | null = null,
  clubIndex: ClubIndex | null = null,
  luckyNumbers: number[] = [],
  teamsQuality: TeamsQualityStore | null = null,
  statExtras?: {
    leagueBaselines?: import("./league-baselines").LeagueBaselinesStore | null;
    mlClassifier?: import("./ml-model-store").MlClassifierStore | null;
    leagueProfiles?: import("./types").LeagueProfilesStore | null;
  }
): TieredRecommendationResult {
  const leagueCharacterProfile = resolveLeagueCharacterProfile(
    statExtras?.leagueProfiles ?? null,
    sourceBatch.league,
    sourceBatch.date
  );
  const artifacts = buildRecommendationArtifacts(
    sourceBatch,
    allBatches,
    analysis,
    settings,
    clubProfiles,
    clubRecords,
    clubIndex,
    luckyNumbers,
    {
      teamsQuality,
      leagueBaselines: statExtras?.leagueBaselines ?? null,
      mlClassifier: statExtras?.mlClassifier ?? null,
      leagueProfiles: statExtras?.leagueProfiles ?? null,
    }
  );
  const recommendationBaseId = nextRecommendationBaseId(allBatches, new Date());

  const priorOccupied = collectPriorOccupiedMarkets(sourceBatch, allBatches);
  const claimedInSession = new Set(priorOccupied.keys);
  const sessionLabels: string[] = [...priorOccupied.batchNames];

  const tiers: PredictionBatch[] = [];
  for (const tier of ["safe", "balanced", "aggressive"] as RecommendationTier[]) {
    const tierPool =
      tier === "aggressive" ? artifacts.allLegCandidates : artifacts.candidates;

    const tierSelection = selectTierCandidates(
      tier,
      artifacts,
      allBatches,
      analysis,
      settings,
      teamsQuality,
      leagueCharacterProfile
    );
    let selected = tierSelection.selected;
    const trimRemoved = tierSelection.trimRemoved;
    const dedupSourceLabel =
      sessionLabels.length > 0 ? sessionLabels.join(", ") : "an earlier tier";
    let { eligible, removed } = filterCandidatesByOccupiedMarkets(
      selected,
      claimedInSession,
      dedupSourceLabel
    );

    if (eligible.length === 0 && selected.length > 0) {
      const fallbackPool = [...tierPool]
        .filter((candidate) => candidate.passesHardFilters)
        .sort(sortByStrength);
      const fallback = filterCandidatesByOccupiedMarkets(
        fallbackPool,
        claimedInSession,
        dedupSourceLabel
      );
      eligible = fallback.eligible;
      removed = [
        ...removed,
        ...selected,
        ...fallback.removed.filter(
          (candidate) =>
            !removed.some(
              (entry) =>
                entry.matchId === candidate.matchId && entry.marketKey === candidate.marketKey
            )
        ),
      ];
    }

    selected = eligible;
    const selection = selectionFromCandidates(selected, artifacts.candidates, removed);
    let recommended = buildRecommendedBatchFromSelection(
      sourceBatch,
      artifacts.ctx,
      artifacts.candidates,
      selection,
      TIER_META[tier].label,
      tier
    );

    if (!recommended) {
      const emptyNotice = formatSameDateDedupNotice(
        removed.length,
        sessionLabels.length > 0 ? sessionLabels : [TIER_META[tier].batchLabel]
      );
      recommended = {
        displayName: TIER_META[tier].label,
        generatedAt: new Date().toISOString(),
        engineVersion: RECO_ENGINE_VERSION,
        tier,
        matches: [],
        acceptAll: false,
        summary: {
          totalCombinedOdds: null,
          riskLevel: "high",
          matchesIncluded: 0,
          matchesDropped: sourceBatch.matches.length,
          summaryJudgment:
            emptyNotice ||
            "No unoccupied markets remained for this tier after same-date deduplication.",
          exclusions: removed.map((candidate) => ({
            matchId: candidate.matchId,
            homeTeam: candidate.homeTeam,
            awayTeam: candidate.awayTeam,
            reason: candidate.exclusionReason ?? emptyNotice,
          })),
        },
        gameList: [],
      };
    }

    if (removed.length > 0) {
      const notice = formatSameDateDedupNotice(removed.length, sessionLabels);
      const dedupExclusions = removed.map((candidate) => ({
        matchId: candidate.matchId,
        homeTeam: candidate.homeTeam,
        awayTeam: candidate.awayTeam,
        reason: candidate.exclusionReason ?? notice,
      }));
      recommended = {
        ...recommended,
        summary: {
          ...recommended.summary,
          summaryJudgment: notice
            ? `${recommended.summary.summaryJudgment} ${notice}`
            : recommended.summary.summaryJudgment,
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

    const learnerBatch = maybeOverlayLearner(
      recommended,
      sourceBatch,
      learnerEnabled,
      learnerStats,
      settings,
      teamCharacteristics
    );

    for (const key of occupiedFromCandidates(selected)) {
      claimedInSession.add(key);
    }
    if (!sessionLabels.includes(TIER_META[tier].batchLabel)) {
      sessionLabels.push(TIER_META[tier].batchLabel);
    }

    const freezeMetadata: TierFreezeMetadata = {
      tier,
      allLegCandidates: artifacts.allLegCandidates,
      preTrimSelected: tierSelection.selected,
      postTrimSelected: selected,
      removedFromDedup: removed,
      trimRemoved,
    };

    tiers.push(
      createTierBatch(
        sourceBatch,
        learnerBatch,
        tier,
        recommendationBaseId,
        allBatches,
        analysis,
        settings,
        learnerEnabled,
        luckyNumbers,
        freezeMetadata,
        teamsQuality,
        leagueCharacterProfile
      )
    );
  }


  return { sourceBatch, tiers };
}
