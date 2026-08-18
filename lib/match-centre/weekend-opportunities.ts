/**
 * Weekend opportunistic picks — Match Centre upcoming fixtures,
 * best market per match, top 10–20 by calibrated probability.
 */
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import { sortDedupeUpcomingFixtures } from "@/lib/prediction-log/batch-fixture-picker";
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

export const WEEKEND_PICK_MIN = 10;
export const WEEKEND_PICK_MAX = 20;
export const WEEKEND_WINDOW_DAYS = 7;
export const WEEKEND_TOTALS_OVER_MIN_LINE = 1.5;
export const WEEKEND_TOTALS_UNDER_MAX_LINE = 4.5;
/** Minimum calibrated-probability gap between best and 2nd-best market on a fixture. */
export const WEEKEND_MARKET_MARGIN_MIN = 0.05;

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
  cfeProvenance: CanonicalFixtureEstimate["provenance"];
  apiSeasonBlend?: string;
  family: MarketFamilyId;
  selectionKey: string;
  pRaw: number;
  pCalibrated: number;
  nEffective: number;
  coherenceOk: boolean;
  secondBestPCalibrated?: number;
  marketMargin?: number;
  marginOk?: boolean;
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
  probabilityPct: number;
  pRaw: number;
  pCalibrated: number;
  rank: number;
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

function isWeekendUtc(iso: string): boolean {
  const day = new Date(iso).getUTCDay();
  return day === 0 || day === 6;
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

/** Sat–Sun kickoffs within the next 7 days (UTC). */
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
    return isWeekendUtc(f.kickoffIso);
  });

  return sortDedupeUpcomingFixtures(filtered);
}

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
} | null;

export function scoreFixtureBestMarket(
  fixture: UpcomingFixtureRow,
  estimate: CanonicalFixtureEstimate,
  calibrator: BinCalibrator | null,
  opts?: { applyMarginGate?: boolean }
): BestMarketPick {
  const applyMarginGate = opts?.applyMarginGate !== false;
  const candidates: Array<{
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
  }> = [];

  for (const family of MARKET_FAMILY_IDS) {
    if (!familyDataOk(family, estimate)) continue;

    for (const sel of enumerateFamilySelections(family)) {
      if (!weekendComboSelectionAllowed(family, sel.comboId)) {
        continue;
      }
      if (
        !weekendTotalsSelectionAllowed(family, sel.selectionKey, sel.line)
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
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.pCalibrated !== a.pCalibrated) return b.pCalibrated - a.pCalibrated;
    if (b.pRaw !== a.pRaw) return b.pRaw - a.pRaw;
    return 0;
  });

  const best = candidates[0]!;
  const second = candidates[1];
  const margin =
    second != null ? best.pCalibrated - second.pCalibrated : best.pCalibrated;

  if (applyMarginGate && margin < WEEKEND_MARKET_MARGIN_MIN) return null;

  return {
    ...best,
    secondBestPCalibrated: second?.pCalibrated,
    marketMargin: margin,
  };
}

export function selectWeekendPickCount(poolSize: number): {
  count: number;
  insufficientPool: boolean;
} {
  if (poolSize < WEEKEND_PICK_MIN) {
    return { count: poolSize, insufficientPool: poolSize > 0 };
  }
  return {
    count: Math.min(WEEKEND_PICK_MAX, Math.max(WEEKEND_PICK_MIN, poolSize)),
    insufficientPool: false,
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

  const strictScored: Array<{
    fixture: UpcomingFixtureRow;
    estimate: CanonicalFixtureEstimate;
    pick: NonNullable<BestMarketPick>;
    marginOk: boolean;
  }> = [];
  const relaxedScored: typeof strictScored = [];

  for (let i = 0; i < input.fixtures.length; i++) {
    const fixture = input.fixtures[i]!;
    const estimate = input.estimates[i];
    if (!estimate) continue;

    const strictPick = scoreFixtureBestMarket(
      fixture,
      estimate,
      input.calibrator,
      { applyMarginGate: true }
    );
    if (strictPick) {
      strictScored.push({
        fixture,
        estimate,
        pick: strictPick,
        marginOk: true,
      });
      continue;
    }

    const relaxedPick = scoreFixtureBestMarket(
      fixture,
      estimate,
      input.calibrator,
      { applyMarginGate: false }
    );
    if (!relaxedPick) continue;
    relaxedScored.push({
      fixture,
      estimate,
      pick: relaxedPick,
      marginOk: false,
    });
  }

  const sortScored = (
    a: (typeof strictScored)[number],
    b: (typeof strictScored)[number]
  ) => {
    if (b.pick.pCalibrated !== a.pick.pCalibrated) {
      return b.pick.pCalibrated - a.pick.pCalibrated;
    }
    if (b.pick.pRaw !== a.pick.pRaw) return b.pick.pRaw - a.pick.pRaw;
    return kickoffMs(a.fixture.kickoffIso) - kickoffMs(b.fixture.kickoffIso);
  };

  strictScored.sort(sortScored);
  relaxedScored.sort(sortScored);

  let scored = [...strictScored];
  if (scored.length < WEEKEND_PICK_MIN) {
    for (const row of relaxedScored) {
      if (scored.length >= WEEKEND_PICK_MIN) break;
      scored.push(row);
    }
  }
  if (scored.length < WEEKEND_PICK_MIN) {
    scored = [...strictScored, ...relaxedScored].sort(sortScored);
  }

  const { count, insufficientPool } = selectWeekendPickCount(scored.length);
  const top = scored.slice(0, count);

  const rows: WeekendOpportunityRow[] = top.map(
    ({ fixture, estimate, pick, marginOk }, idx) => ({
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
    },
  })
  );

  return {
    rows,
    fixturePoolCount: input.fixtures.length,
    selectedCount: rows.length,
    insufficientPool,
    window: {
      from: now.toISOString(),
      to: end.toISOString(),
    },
  };
}
