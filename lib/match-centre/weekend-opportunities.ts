/**
 * Weekend opportunistic picks — Match Centre upcoming fixtures,
 * best market per match for every upcoming fixture in the next 7 days (Mon–Sun),
 */
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import { NEXT_MATCHES_LEAGUES } from "@/lib/football-api/fetch-upcoming-league";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import { sortDedupeUpcomingFixtures } from "@/lib/prediction-log/batch-fixture-picker";
import {
  weekendMsamEligible,
  weekendMsamIneligibilityReasons,
} from "@/lib/market-advisory/weekend-eligibility-gate";
import type { IneligibilityReasonCode } from "@/lib/market-advisory/types";
import type { BinCalibrator } from "@/lib/predictor/calibration";
import { scoreLegFromCanonical } from "@/lib/slip-builder/canonical-leg";
import {
  enumerateFamilySelections,
  FAMILY_LABELS,
} from "@/lib/slip-builder/families";
import { applySlipCalibration } from "@/lib/slip-builder/slip-calibration";
import {
  MARKET_FAMILY_IDS,
  type MarketFamilyId,
} from "@/lib/slip-builder/types";

/** @deprecated Weekend Picks now includes all fixtures in the pool. */
export const WEEKEND_PICK_MIN = 10;
/** @deprecated Weekend Picks now includes all fixtures in the pool. */
export const WEEKEND_PICK_MAX = 20;
export const WEEKEND_WINDOW_DAYS = 7;
export const WEEKEND_TOTALS_OVER_MIN_LINE = 1.5;
export const WEEKEND_TOTALS_UNDER_MAX_LINE = 4.5;
export const WEEKEND_TEAM_GOALS_OVER_MIN_LINE = 0.5;
export const WEEKEND_TEAM_GOALS_UNDER_MAX_LINE = 1.5;
/** Minimum calibrated-probability gap between best and 2nd-best (trace only). */
export const WEEKEND_MARKET_MARGIN_MIN = 0.05;

/** Specialist markets trusted on Weekend Picks when they have the highest probability. */
export const WEEKEND_SPECIALIST_FAMILIES = [
  "DIEH",
  "CORNERS",
  "HANDICAP",
  "HSH",
  "WIN_ONE_HALF",
] as const satisfies readonly MarketFamilyId[];

/** Core Double Chance + Over Total combos for Weekend Picks. */
export const WEEKEND_DC_TOTAL_COMBO_IDS = [
  "1x_over_1_5",
  "1x_over_2_5",
  "x2_over_1_5",
  "x2_over_2_5",
  "12_over_1_5",
  "12_over_2_5",
] as const;

export const WEEKEND_COMBO_IDS = new Set([
  "1x_btts_yes",
  "x2_btts_yes",
  "12_btts_yes",
  ...WEEKEND_DC_TOTAL_COMBO_IDS,
  "btts_yes_over_2_5",
  "btts_yes_over_3_5",
  "btts_no_under_2_5",
  "btts_no_over_1_5",
  "btts_no_under_3_5",
  "home_over_1_5",
  "home_over_2_5",
  "home_under_3_5",
  "away_over_1_5",
  "away_over_2_5",
  "away_under_3_5",
  "draw_under_2_5",
]);

/** Exclude trivial Total Goals lines (Over 0.5, Under 5.5/6.5) from Weekend Picks. */
export function weekendTotalsSelectionAllowed(
  family: MarketFamilyId,
  selectionKey: string,
  line?: number
): boolean {
  if (family !== "TOTALS" || line == null) return true;
  if (selectionKey.startsWith("over_")) {
    return line >= WEEKEND_TOTALS_OVER_MIN_LINE;
  }
  if (selectionKey.startsWith("under_")) {
    return line <= WEEKEND_TOTALS_UNDER_MAX_LINE;
  }
  return true;
}

/** Team Goals: Over ≥0.5, Under ≤1.5; clean sheets always allowed. */
export function weekendTeamGoalsSelectionAllowed(
  family: MarketFamilyId,
  selectionKey: string,
  line?: number
): boolean {
  if (family !== "TEAM_GOALS") return true;
  if (line == null) return true;
  if (selectionKey.includes("_over_")) {
    return line >= WEEKEND_TEAM_GOALS_OVER_MIN_LINE;
  }
  if (selectionKey.includes("_under_")) {
    return line <= WEEKEND_TEAM_GOALS_UNDER_MAX_LINE;
  }
  return true;
}

/** Weekend Picks combos: DC+BTTS, DC+Total (Over), BTTS+Total, Win+Total. */
export function weekendComboSelectionAllowed(
  family: MarketFamilyId,
  comboId?: string
): boolean {
  if (family !== "COMBO") return true;
  return comboId != null && WEEKEND_COMBO_IDS.has(comboId);
}

export type WeekendOpportunityTrace = {
  fixtureSource: "match_centre_upcoming";
  cfeProvenance?: CanonicalFixtureEstimate["provenance"];
  apiSeasonBlend?: string;
  family?: MarketFamilyId;
  selectionKey?: string;
  pRaw: number;
  pCalibrated: number;
  nEffective: number;
  coherenceOk: boolean;
  secondBestPCalibrated?: number;
  marketMargin?: number;
  marginOk?: boolean;
  msamGatePassed?: boolean;
  ineligibilityReasons?: IneligibilityReasonCode[];
  noEstimate?: boolean;
};

export type WeekendOpportunityRow = {
  apiFixtureId: number;
  league: string;
  kickoffIso: string;
  matchLabel: string;
  homeTeam: string;
  awayTeam: string;
  marketLabel: string;
  prediction: string;
  probabilityPct: number | null;
  pRaw: number;
  pCalibrated: number;
  rank: number;
  msamGatePassed: boolean;
  trace: WeekendOpportunityTrace;
};

export type WeekendOpportunityResult = {
  rows: WeekendOpportunityRow[];
  fixturePoolCount: number;
  selectedCount: number;
  insufficientPool: boolean;
  window: { from: string; to: string };
};

function kickoffMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Big-5 league display order (same as Next Matches / Live). Unknown leagues sort last. */
export function weekendLeagueSortIndex(league: string): number {
  const idx = (NEXT_MATCHES_LEAGUES as readonly string[]).indexOf(league);
  return idx >= 0 ? idx : NEXT_MATCHES_LEAGUES.length;
}

/** All kickoffs within the next 7 days (UTC), NS/TBD only. */
export function filterWeekendFixtures(
  fixtures: UpcomingFixtureRow[],
  opts?: { now?: Date }
): UpcomingFixtureRow[] {
  const now = opts?.now ?? new Date();
  const startMs = now.getTime();
  const endMs = startMs + WEEKEND_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const filtered = fixtures.filter((f) => {
    const status = (f.status ?? "").toUpperCase();
    if (status !== "NS" && status !== "TBD") return false;
    const ms = kickoffMs(f.kickoffIso);
    if (ms < startMs || ms > endMs) return false;
    return true;
  });

  return sortDedupeUpcomingFixtures(filtered);
}

function lambdasComplete(est: CanonicalFixtureEstimate): boolean {
  const L = est.lambdas;
  const vals = [L.home, L.away, L.home_1h, L.away_1h, L.home_2h, L.away_2h];
  return vals.every((v) => Number.isFinite(v) && v > 0);
}

function familyDataOk(
  family: MarketFamilyId,
  est: CanonicalFixtureEstimate
): boolean {
  if (!lambdasComplete(est)) return false;
  if (
    !est.diagnostics.halfSumOk &&
    (family === "HALF_GOALS" ||
      family === "HT_RESULT" ||
      family === "DIEH" ||
      family === "WIN_ONE_HALF")
  ) {
    return false;
  }
  if (family === "HSH") {
    const sum = est.markets.p1h + est.markets.p2h + est.markets.pTie;
    if (!(sum > 0.95 && sum < 1.05)) return false;
    return true;
  }
  if (family === "DIEH" && est.markets.dieh.status !== "ok") return false;
  if (family === "SOT") {
    const sot = est.markets.sot;
    if (!sot || sot.status !== "ok") return false;
  }
  if (!est.score_matrix?.length) return false;
  return true;
}

type ScoredCandidate = {
  marketLabel: string;
  predictionLabel: string;
  family: MarketFamilyId;
  selectionKey: string;
  line?: number;
  comboId?: string;
  pRaw: number;
  pCalibrated: number;
  nEffective: number;
  coherenceOk: boolean;
  msamGatePassed: boolean;
  ineligibilityReasons: IneligibilityReasonCode[];
};

export type BestMarketPick = {
  marketLabel: string;
  predictionLabel: string;
  family: MarketFamilyId;
  selectionKey: string;
  line?: number;
  comboId?: string;
  pRaw: number;
  pCalibrated: number;
  nEffective: number;
  coherenceOk: boolean;
  secondBestPCalibrated?: number;
  marketMargin?: number;
  msamGatePassed: boolean;
  ineligibilityReasons: IneligibilityReasonCode[];
} | null;

export function scoreFixtureBestMarket(
  fixture: UpcomingFixtureRow,
  estimate: CanonicalFixtureEstimate,
  calibrator: BinCalibrator | null
): BestMarketPick {
  const candidates: ScoredCandidate[] = [];

  for (const family of MARKET_FAMILY_IDS) {
    if (!familyDataOk(family, estimate)) continue;

    for (const sel of enumerateFamilySelections(family)) {
      if (!weekendComboSelectionAllowed(family, sel.comboId)) continue;
      if (!weekendTotalsSelectionAllowed(family, sel.selectionKey, sel.line)) {
        continue;
      }
      if (
        !weekendTeamGoalsSelectionAllowed(family, sel.selectionKey, sel.line)
      ) {
        continue;
      }

      const scored = scoreLegFromCanonical({
        estimate,
        family,
        selectionKey: sel.selectionKey,
        line: sel.line,
        comboId: sel.comboId,
        fixtureKey: `api:${fixture.apiFixtureId}`,
      });
      if (!scored.available || !Number.isFinite(scored.pRaw)) continue;

      const cal = applySlipCalibration(
        scored.pRaw,
        scored.nEffective,
        calibrator
      );

      const ineligibilityReasons = weekendMsamIneligibilityReasons({
        family,
        pRaw: scored.pRaw,
        nEffective: scored.nEffective,
        coherenceOk: scored.coherenceOk,
        cfe: estimate,
      });
      const msamGatePassed = ineligibilityReasons.length === 0;

      candidates.push({
        marketLabel: FAMILY_LABELS[family],
        predictionLabel: sel.selectionLabel,
        family,
        selectionKey: sel.selectionKey,
        line: sel.line,
        comboId: sel.comboId,
        pRaw: scored.pRaw,
        pCalibrated: cal.pCalibrated,
        nEffective: scored.nEffective,
        coherenceOk: scored.coherenceOk,
        msamGatePassed,
        ineligibilityReasons,
      });
    }
  }

  if (candidates.length === 0) return null;

  const sortByProb = (a: ScoredCandidate, b: ScoredCandidate) => {
    if (b.pCalibrated !== a.pCalibrated) return b.pCalibrated - a.pCalibrated;
    if (b.pRaw !== a.pRaw) return b.pRaw - a.pRaw;
    return 0;
  };

  const pool = [...candidates].sort(sortByProb);

  const best = pool[0]!;
  const second = pool[1];
  const margin =
    second != null ? best.pCalibrated - second.pCalibrated : best.pCalibrated;

  return {
    marketLabel: best.marketLabel,
    predictionLabel: best.predictionLabel,
    family: best.family,
    selectionKey: best.selectionKey,
    line: best.line,
    comboId: best.comboId,
    pRaw: best.pRaw,
    pCalibrated: best.pCalibrated,
    nEffective: best.nEffective,
    coherenceOk: best.coherenceOk,
    secondBestPCalibrated: second?.pCalibrated,
    marketMargin: margin,
    msamGatePassed: best.msamGatePassed,
    ineligibilityReasons: best.ineligibilityReasons,
  };
}

/** @deprecated All fixtures in the pool are now included. */
export function selectWeekendPickCount(poolSize: number): {
  count: number;
  insufficientPool: boolean;
} {
  return { count: poolSize, insufficientPool: false };
}

function emptyRow(
  fixture: UpcomingFixtureRow,
  rank: number
): WeekendOpportunityRow {
  return {
    apiFixtureId: fixture.apiFixtureId,
    league: fixture.league,
    kickoffIso: fixture.kickoffIso,
    matchLabel: `${fixture.home.name} vs ${fixture.away.name}`,
    homeTeam: fixture.home.name,
    awayTeam: fixture.away.name,
    marketLabel: "—",
    prediction: "—",
    probabilityPct: null,
    pRaw: 0,
    pCalibrated: 0,
    rank,
    msamGatePassed: false,
    trace: {
      fixtureSource: "match_centre_upcoming",
      pRaw: 0,
      pCalibrated: 0,
      nEffective: 0,
      coherenceOk: false,
      noEstimate: true,
      msamGatePassed: false,
    },
  };
}

export function rankWeekendOpportunities(input: {
  fixtures: UpcomingFixtureRow[];
  estimates: CanonicalFixtureEstimate[];
  calibrator: BinCalibrator | null;
  now?: Date;
}): WeekendOpportunityResult {
  const now = input.now ?? new Date();
  const end = new Date(now.getTime() + WEEKEND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const scored: Array<{
    fixture: UpcomingFixtureRow;
    estimate: CanonicalFixtureEstimate | null;
    pick: BestMarketPick;
  }> = [];

  for (let i = 0; i < input.fixtures.length; i++) {
    const fixture = input.fixtures[i]!;
    const estimate = input.estimates[i] ?? null;
    if (!estimate) {
      scored.push({ fixture, estimate: null, pick: null });
      continue;
    }
    const pick = scoreFixtureBestMarket(fixture, estimate, input.calibrator);
    scored.push({ fixture, estimate, pick });
  }

  const sortScored = (
    a: (typeof scored)[number],
    b: (typeof scored)[number]
  ) => {
    const aP = a.pick?.pCalibrated ?? -1;
    const bP = b.pick?.pCalibrated ?? -1;
    if (bP !== aP) return bP - aP;
    const aRaw = a.pick?.pRaw ?? -1;
    const bRaw = b.pick?.pRaw ?? -1;
    if (bRaw !== aRaw) return bRaw - aRaw;
    const leagueDiff =
      weekendLeagueSortIndex(a.fixture.league) -
      weekendLeagueSortIndex(b.fixture.league);
    if (leagueDiff !== 0) return leagueDiff;
    return kickoffMs(a.fixture.kickoffIso) - kickoffMs(b.fixture.kickoffIso);
  };

  scored.sort(sortScored);

  const rows: WeekendOpportunityRow[] = scored.map(
    ({ fixture, estimate, pick }, idx) => {
      if (!estimate || !pick) {
        return emptyRow(fixture, idx + 1);
      }

      const marginOk =
        pick.marketMargin != null &&
        pick.marketMargin >= WEEKEND_MARKET_MARGIN_MIN;

      return {
        apiFixtureId: fixture.apiFixtureId,
        league: fixture.league,
        kickoffIso: fixture.kickoffIso,
        matchLabel: `${fixture.home.name} vs ${fixture.away.name}`,
        homeTeam: fixture.home.name,
        awayTeam: fixture.away.name,
        marketLabel: pick.marketLabel,
        prediction: pick.predictionLabel,
        probabilityPct: Math.round(pick.pCalibrated * 1000) / 10,
        pRaw: pick.pRaw,
        pCalibrated: pick.pCalibrated,
        rank: idx + 1,
        msamGatePassed: pick.msamGatePassed,
        trace: {
          fixtureSource: "match_centre_upcoming",
          cfeProvenance: estimate.provenance,
          apiSeasonBlend: estimate.provenance.apiSeasonBlend,
          family: pick.family,
          selectionKey: pick.selectionKey,
          pRaw: pick.pRaw,
          pCalibrated: pick.pCalibrated,
          nEffective: pick.nEffective,
          coherenceOk: pick.coherenceOk,
          secondBestPCalibrated: pick.secondBestPCalibrated,
          marketMargin: pick.marketMargin,
          marginOk,
          msamGatePassed: pick.msamGatePassed,
          ineligibilityReasons:
            pick.ineligibilityReasons.length > 0
              ? pick.ineligibilityReasons
              : undefined,
        },
      };
    }
  );

  return {
    rows,
    fixturePoolCount: input.fixtures.length,
    selectedCount: rows.length,
    insufficientPool: input.fixtures.length === 0,
    window: {
      from: now.toISOString(),
      to: end.toISOString(),
    },
  };
}
