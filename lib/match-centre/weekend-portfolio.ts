/**
 * Curated 24-match Weekend Portfolio — one unique fixture per slot,
 * top collaborative MSAM score per market category.
 */
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import {
  DEFAULT_COMBO_MARKETS,
  EXTENDED_COMBO_FAMILY_IDS,
} from "@/lib/prediction-log/combo-markets-config";
import {
  bestTeamCornerOuLeg,
  predictCornersMatch,
} from "@/lib/prediction-log/corners-model";
import { scorePortfolioProposition } from "@/lib/market-advisory/score-portfolio-proposition";
import type { AgreementStatus, AdvisoryTier } from "@/lib/market-advisory/types";
import type { AnalysisHistory, MarketReliabilityEntry, PredictionBatch } from "@/lib/prediction-log/types";
import {
  lookupPortfolioReliabilityBoost,
  portfolioLegToMarketSelection,
} from "@/lib/prediction-log/learner-market-reliability";
import type { BinCalibrator } from "@/lib/predictor/calibration";
import {
  legToMarketCode,
  teamCornerSelectionKey,
} from "./portfolio-category-map";
import {
  comparePortfolioRankings,
  formatShadowDiffs,
  type PortfolioShadowDiff,
} from "./portfolio-shadow-log";
import {
  scoreFixtureFamilyBest,
  scoreFixtureSelection,
  type ScoredLeg,
  weekendLeagueSortIndex,
  WEEKEND_COMBO_IDS,
} from "./weekend-opportunities";

export const PORTFOLIO_TARGET_TOTAL = 24;

export type PortfolioCategoryId =
  | "hsh_2h"
  | "corners"
  | "dieh"
  | "totals"
  | "win_one_half"
  | "combo"
  | "goal_both_halves"
  | "team_corners_ou"
  | "result_1x2"
  | "double_chance";

export type PortfolioCategoryMeta = {
  id: PortfolioCategoryId;
  label: string;
  quota: number;
  reduced: boolean;
  defaultQuota: number;
};

export type PortfolioPickTrace = {
  family?: ScoredLeg["family"];
  selectionKey?: string;
  line?: number;
  comboId?: string;
  marketCode?: string;
  marketLabel: string;
  msamGatePassed: boolean;
  msamScore?: number;
  msamNormalizedScore?: number | null;
  existingNormalizedScore?: number | null;
  emsRawScore?: number;
  finalAdvisoryScore?: number | null;
  agreementStatus?: AgreementStatus;
  advisoryStatus?: AdvisoryTier;
  ineligibilityReasons?: string[];
  learnerReliabilityNote?: string;
  learnerReliabilityBoost?: number;
};

export type PortfolioPick = {
  category: PortfolioCategoryId;
  apiFixtureId: number;
  matchLabel: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffIso: string;
  prediction: string;
  pRaw: number;
  pCalibrated: number;
  rankInCategory: number;
  trace: PortfolioPickTrace;
};

export type WeekendPortfolioResult = {
  picks: PortfolioPick[];
  categories: PortfolioCategoryMeta[];
  reducedCategories: PortfolioCategoryId[];
  warnings: string[];
  shadowDiffs?: PortfolioShadowDiff[];
};

const REDUCIBLE_CATEGORIES: Array<{
  id: Exclude<PortfolioCategoryId, "result_1x2" | "double_chance">;
  label: string;
  defaultQuota: 3;
}> = [
  { id: "hsh_2h", label: "Highest Scoring Half — 2nd Half", defaultQuota: 3 },
  { id: "corners", label: "Match Corners", defaultQuota: 3 },
  { id: "dieh", label: "Draw Either Half", defaultQuota: 3 },
  { id: "totals", label: "Total Goals", defaultQuota: 3 },
  { id: "win_one_half", label: "Win at Least One Half", defaultQuota: 3 },
  { id: "combo", label: "Combined Odds", defaultQuota: 3 },
  { id: "goal_both_halves", label: "Goals in Both Halves", defaultQuota: 3 },
  { id: "team_corners_ou", label: "Team Corner O/U", defaultQuota: 3 },
];

const FIXED_CATEGORIES: Array<{
  id: "result_1x2" | "double_chance";
  label: string;
  quota: number;
}> = [
  { id: "result_1x2", label: "Match Result (1X2)", quota: 2 },
  { id: "double_chance", label: "Double Chance", quota: 1 },
];

const PORTFOLIO_COMBO_IDS = new Set([
  ...WEEKEND_COMBO_IDS,
  ...EXTENDED_COMBO_FAMILY_IDS,
]);

const COMBO_LABEL_BY_ID = new Map(
  DEFAULT_COMBO_MARKETS.map((m) => [m.id, m.label])
);

export type PortfolioCategoryScore = {
  fixture: UpcomingFixtureRow;
  leg: ScoredLeg;
  marketCode: string;
  pRaw: number;
  pCalibrated: number;
  finalAdvisoryScore: number;
  msamScore: number;
  msamNormalizedScore: number | null;
  existingNormalizedScore: number | null;
  emsRawScore: number;
  agreementStatus: AgreementStatus;
  advisoryStatus: AdvisoryTier;
  msamEligible: boolean;
  ineligibilityReasons: string[];
  learnerReliabilityNote?: string;
  learnerReliabilityBoost?: number;
};

function kickoffMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function compareRankedScores(a: PortfolioCategoryScore, b: PortfolioCategoryScore): number {
  if (b.finalAdvisoryScore !== a.finalAdvisoryScore) {
    return b.finalAdvisoryScore - a.finalAdvisoryScore;
  }
  if (b.pCalibrated !== a.pCalibrated) {
    return b.pCalibrated - a.pCalibrated;
  }
  if (b.pRaw !== a.pRaw) return b.pRaw - a.pRaw;
  const leagueDiff =
    weekendLeagueSortIndex(a.fixture.league) -
    weekendLeagueSortIndex(b.fixture.league);
  if (leagueDiff !== 0) return leagueDiff;
  return kickoffMs(a.fixture.kickoffIso) - kickoffMs(b.fixture.kickoffIso);
}

function compareLegacyScores(a: PortfolioCategoryScore, b: PortfolioCategoryScore): number {
  if (b.pCalibrated !== a.pCalibrated) return b.pCalibrated - a.pCalibrated;
  if (b.pRaw !== a.pRaw) return b.pRaw - a.pRaw;
  return compareRankedScores(a, b);
}

function toPortfolioPick(
  category: PortfolioCategoryId,
  score: PortfolioCategoryScore,
  rankInCategory: number
): PortfolioPick {
  const { fixture, leg } = score;
  return {
    category,
    apiFixtureId: fixture.apiFixtureId,
    matchLabel: `${fixture.home.name} vs ${fixture.away.name}`,
    homeTeam: fixture.home.name,
    awayTeam: fixture.away.name,
    league: fixture.league,
    kickoffIso: fixture.kickoffIso,
    prediction: leg.predictionLabel,
    pRaw: score.pRaw,
    pCalibrated: score.pCalibrated,
    rankInCategory,
    trace: {
      family: leg.family,
      selectionKey: leg.selectionKey,
      line: leg.line,
      comboId: leg.comboId,
      marketCode: score.marketCode,
      marketLabel: leg.marketLabel,
      msamGatePassed: leg.msamGatePassed && score.msamEligible,
      msamScore: score.msamScore,
      msamNormalizedScore: score.msamNormalizedScore,
      existingNormalizedScore: score.existingNormalizedScore,
      emsRawScore: score.emsRawScore,
      finalAdvisoryScore: score.finalAdvisoryScore,
      agreementStatus: score.agreementStatus,
      advisoryStatus: score.advisoryStatus,
      ineligibilityReasons: score.ineligibilityReasons,
      learnerReliabilityNote: score.learnerReliabilityNote,
      learnerReliabilityBoost: score.learnerReliabilityBoost,
    },
  };
}

function scoreCategoryLeg(
  category: PortfolioCategoryId,
  fixture: UpcomingFixtureRow,
  estimate: CanonicalFixtureEstimate,
  calibrator: BinCalibrator | null,
  batches: PredictionBatch[]
): ScoredLeg | null {
  switch (category) {
    case "hsh_2h":
      return scoreFixtureSelection(fixture, estimate, calibrator, {
        family: "HSH",
        selectionKey: "2h_gt_1h",
        selectionLabel: "2nd Half",
        marketLabel: "Highest Scoring Half",
      });
    case "corners":
      return scoreFixtureFamilyBest(fixture, estimate, calibrator, "CORNERS");
    case "dieh":
      return scoreFixtureFamilyBest(fixture, estimate, calibrator, "DIEH");
    case "totals":
      return scoreFixtureFamilyBest(fixture, estimate, calibrator, "TOTALS");
    case "win_one_half":
      return scoreFixtureFamilyBest(fixture, estimate, calibrator, "WIN_ONE_HALF");
    case "result_1x2":
      return scoreFixtureFamilyBest(fixture, estimate, calibrator, "RESULT_1X2");
    case "double_chance":
      return scoreFixtureFamilyBest(fixture, estimate, calibrator, "DOUBLE_CHANCE");
    case "combo": {
      let best: ScoredLeg | null = null;
      for (const comboId of PORTFOLIO_COMBO_IDS) {
        const label = COMBO_LABEL_BY_ID.get(comboId) ?? comboId;
        const scored = scoreFixtureSelection(fixture, estimate, calibrator, {
          family: "COMBO",
          selectionKey: comboId,
          selectionLabel: label,
          comboId,
          marketLabel: "Combo",
        });
        if (!scored) continue;
        if (
          !best ||
          scored.pCalibrated > best.pCalibrated ||
          (scored.pCalibrated === best.pCalibrated && scored.pRaw > best.pRaw)
        ) {
          best = scored;
        }
      }
      return best;
    }
    case "goal_both_halves":
      return scoreFixtureSelection(fixture, estimate, calibrator, {
        family: "HALF_GOALS",
        selectionKey: "goal_both_halves",
        selectionLabel: "Goal in 1H & 2H",
        marketLabel: "Goals in Both Halves",
      });
    case "team_corners_ou": {
      const corners = predictCornersMatch({
        matchId: `api:${fixture.apiFixtureId}`,
        homeTeam: fixture.home.name,
        awayTeam: fixture.away.name,
        league: fixture.league,
        batches,
        beforeDate: fixture.matchDate,
      });
      const cornerLeg = bestTeamCornerOuLeg(corners.lambdaHome, corners.lambdaAway);
      if (!cornerLeg) return null;
      const selectionKey = teamCornerSelectionKey(
        cornerLeg.side,
        cornerLeg.direction,
        cornerLeg.line
      );
      return scoreFixtureSelection(fixture, estimate, calibrator, {
        family: "CORNERS",
        selectionKey,
        selectionLabel: cornerLeg.label,
        line: cornerLeg.line,
        marketLabel: "Team Corner O/U",
      });
    }
    default: {
      const _e: never = category;
      return _e;
    }
  }
}

function scoreCategoryCollaborative(
  category: PortfolioCategoryId,
  fixture: UpcomingFixtureRow,
  estimate: CanonicalFixtureEstimate,
  calibrator: BinCalibrator | null,
  batches: PredictionBatch[],
  analysis: AnalysisHistory | null,
  reliabilityEntries: MarketReliabilityEntry[]
): PortfolioCategoryScore | null {
  const leg = scoreCategoryLeg(category, fixture, estimate, calibrator, batches);
  if (!leg) return null;

  const marketCode = legToMarketCode(leg);
  const collab = scorePortfolioProposition({
    cfe: estimate,
    calibrator,
    analysis,
    leg,
    marketCode,
    fixtureIdentityOk: fixture.apiFixtureId > 0,
  });
  if (!collab || collab.finalAdvisoryScore == null) return null;

  let finalAdvisoryScore = collab.finalAdvisoryScore;
  let learnerReliabilityNote: string | undefined;
  let learnerReliabilityBoost: number | undefined;

  const mapping = portfolioLegToMarketSelection(category, leg);
  if (mapping && reliabilityEntries.length > 0) {
    const rel = lookupPortfolioReliabilityBoost({
      homeTeam: fixture.home.name,
      awayTeam: fixture.away.name,
      league: fixture.league,
      mapping,
      entries: reliabilityEntries,
    });
    if (rel.boost !== 0) {
      finalAdvisoryScore = Math.max(0, finalAdvisoryScore + rel.boost);
      learnerReliabilityBoost = rel.boost;
      learnerReliabilityNote = rel.note ?? undefined;
    }
  }

  return {
    fixture,
    leg,
    marketCode,
    pRaw: collab.pRaw,
    pCalibrated: collab.pCalibrated,
    finalAdvisoryScore,
    msamScore: collab.msamScore,
    msamNormalizedScore: collab.msamNormalizedScore,
    existingNormalizedScore: collab.existingNormalizedScore,
    emsRawScore: collab.emsRawScore,
    agreementStatus: collab.agreementStatus,
    advisoryStatus: collab.advisoryStatus,
    msamEligible: collab.msamEligible,
    ineligibilityReasons: collab.ineligibilityReasons,
    learnerReliabilityNote,
    learnerReliabilityBoost,
  };
}

type CategoryRanking = {
  id: PortfolioCategoryId;
  label: string;
  defaultQuota: number;
  ranked: PortfolioCategoryScore[];
};

function buildCategoryRankings(input: {
  fixtures: UpcomingFixtureRow[];
  estimates: CanonicalFixtureEstimate[];
  calibrator: BinCalibrator | null;
  batches: PredictionBatch[];
  analysis: AnalysisHistory | null;
  reliabilityEntries?: MarketReliabilityEntry[];
}): CategoryRanking[] {
  const estimateById = new Map<number, CanonicalFixtureEstimate>();
  for (let i = 0; i < input.fixtures.length; i++) {
    const est = input.estimates[i];
    const fixture = input.fixtures[i];
    if (est && fixture) estimateById.set(fixture.apiFixtureId, est);
  }

  const allCategories: Array<{
    id: PortfolioCategoryId;
    label: string;
    defaultQuota: number;
  }> = [
    ...REDUCIBLE_CATEGORIES,
    ...FIXED_CATEGORIES.map((c) => ({
      id: c.id,
      label: c.label,
      defaultQuota: c.quota,
    })),
  ];

  return allCategories.map((cat) => {
    const ranked: PortfolioCategoryScore[] = [];
    for (const fixture of input.fixtures) {
      const estimate = estimateById.get(fixture.apiFixtureId);
      if (!estimate) continue;
      const score = scoreCategoryCollaborative(
        cat.id,
        fixture,
        estimate,
        input.calibrator,
        input.batches,
        input.analysis,
        input.reliabilityEntries ?? []
      );
      if (score) ranked.push(score);
    }
    ranked.sort(compareRankedScores);
    return { ...cat, ranked };
  });
}

function buildShadowDiffs(rankings: CategoryRanking[]): PortfolioShadowDiff[] {
  return rankings.map((cat) => {
    const legacySorted = [...cat.ranked].sort(compareLegacyScores);
    return comparePortfolioRankings({
      category: cat.id,
      legacyOrder: legacySorted.map((s) => s.fixture.apiFixtureId),
      collaborativeOrder: cat.ranked.map((s) => s.fixture.apiFixtureId),
    });
  });
}

function computeQuotas(
  reducible: CategoryRanking[]
): Map<PortfolioCategoryId, { quota: number; reduced: boolean }> {
  const quotas = new Map<PortfolioCategoryId, { quota: number; reduced: boolean }>();
  for (const cat of FIXED_CATEGORIES) {
    quotas.set(cat.id, { quota: cat.quota, reduced: false });
  }
  const thirdPickStrength = reducible
    .map((cat) => ({
      id: cat.id,
      thirdScore: cat.ranked[2]?.finalAdvisoryScore ?? -1,
    }))
    .sort((a, b) => a.thirdScore - b.thirdScore);
  const reducedIds = new Set(thirdPickStrength.slice(0, 3).map((x) => x.id));
  for (const cat of reducible) {
    quotas.set(cat.id, {
      quota: reducedIds.has(cat.id) ? 2 : cat.defaultQuota,
      reduced: reducedIds.has(cat.id),
    });
  }
  return quotas;
}

function assignPicks(
  rankings: CategoryRanking[],
  quotas: Map<PortfolioCategoryId, { quota: number; reduced: boolean }>
): { picks: PortfolioPick[]; warnings: string[] } {
  const used = new Set<number>();
  const picks: PortfolioPick[] = [];
  const warnings: string[] = [];

  const assignmentOrder = [...rankings].sort((a, b) => {
    const qa = quotas.get(a.id)?.quota ?? 0;
    const qb = quotas.get(b.id)?.quota ?? 0;
    if (qb !== qa) return qb - qa;
    const topA = a.ranked[0]?.finalAdvisoryScore ?? -1;
    const topB = b.ranked[0]?.finalAdvisoryScore ?? -1;
    return topB - topA;
  });

  for (const cat of assignmentOrder) {
    const quota = quotas.get(cat.id)?.quota ?? cat.defaultQuota;
    let assigned = 0;
    for (const entry of cat.ranked) {
      if (assigned >= quota) break;
      if (used.has(entry.fixture.apiFixtureId)) continue;
      used.add(entry.fixture.apiFixtureId);
      assigned++;
      picks.push(toPortfolioPick(cat.id, entry, assigned));
    }
    if (assigned < quota) {
      warnings.push(
        `${cat.label}: only ${assigned}/${quota} picks filled (pool or uniqueness constraint)`
      );
    }
  }
  return { picks, warnings };
}

export function curateWeekendPortfolio(input: {
  fixtures: UpcomingFixtureRow[];
  estimates: CanonicalFixtureEstimate[];
  calibrator: BinCalibrator | null;
  batches: PredictionBatch[];
  analysis?: AnalysisHistory | null;
  shadowCompare?: boolean;
  reliabilityEntries?: MarketReliabilityEntry[];
}): WeekendPortfolioResult {
  const rankings = buildCategoryRankings({
    fixtures: input.fixtures,
    estimates: input.estimates,
    calibrator: input.calibrator,
    batches: input.batches,
    analysis: input.analysis ?? null,
    reliabilityEntries: input.reliabilityEntries,
  });
  const reducible = rankings.filter((r) =>
    REDUCIBLE_CATEGORIES.some((c) => c.id === r.id)
  );
  const quotas = computeQuotas(reducible);
  const reducedCategories = reducible
    .filter((c) => quotas.get(c.id)?.reduced)
    .map((c) => c.id);
  const { picks, warnings } = assignPicks(rankings, quotas);

  if (picks.length < PORTFOLIO_TARGET_TOTAL) {
    warnings.push(
      `Portfolio has ${picks.length}/${PORTFOLIO_TARGET_TOTAL} picks — fixture pool may be too small`
    );
  }

  const shadowDiffs = input.shadowCompare ? buildShadowDiffs(rankings) : undefined;
  if (shadowDiffs?.length) warnings.push(...formatShadowDiffs(shadowDiffs));

  const categories: PortfolioCategoryMeta[] = rankings.map((cat) => {
    const q = quotas.get(cat.id)!;
    return {
      id: cat.id,
      label: cat.label,
      quota: q.quota,
      reduced: q.reduced,
      defaultQuota: cat.defaultQuota,
    };
  });

  return { picks, categories, reducedCategories, warnings, shadowDiffs };
}
