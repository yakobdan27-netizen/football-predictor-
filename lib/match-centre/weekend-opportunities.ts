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
    (family === "HALF_GOALS" || family === "DIEH" || family === "HT_RESULT")
  ) {
    return false;
  }
  if (family === "DIEH" && est.markets.dieh.status !== "ok") return false;
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
} | null;

export function scoreFixtureBestMarket(
  fixture: UpcomingFixtureRow,
  estimate: CanonicalFixtureEstimate,
  calibrator: BinCalibrator | null
): BestMarketPick {
  let best: BestMarketPick = null;

  for (const family of MARKET_FAMILY_IDS) {
    if (!familyDataOk(family, estimate)) continue;

    for (const sel of enumerateFamilySelections(family)) {
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
      const pCalibrated = cal.pCalibrated;

      if (
        !best ||
        pCalibrated > best.pCalibrated ||
        (pCalibrated === best.pCalibrated && scored.pRaw > best.pRaw)
      ) {
        best = {
          marketLabel: FAMILY_LABELS[family],
          predictionLabel: sel.selectionLabel,
          family,
          selectionKey: sel.selectionKey,
          line: sel.line,
          comboId: sel.comboId,
          pRaw: scored.pRaw,
          pCalibrated,
          nEffective: scored.nEffective,
          coherenceOk: scored.coherenceOk,
        };
      }
    }
  }

  return best;
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

  const scored: Array<{
    fixture: UpcomingFixtureRow;
    estimate: CanonicalFixtureEstimate;
    pick: NonNullable<BestMarketPick>;
  }> = [];

  for (let i = 0; i < input.fixtures.length; i++) {
    const fixture = input.fixtures[i]!;
    const estimate = input.estimates[i];
    if (!estimate) continue;

    const pick = scoreFixtureBestMarket(
      fixture,
      estimate,
      input.calibrator
    );
    if (!pick) continue;

    scored.push({ fixture, estimate, pick });
  }

  scored.sort((a, b) => {
    if (b.pick.pCalibrated !== a.pick.pCalibrated) {
      return b.pick.pCalibrated - a.pick.pCalibrated;
    }
    if (b.pick.pRaw !== a.pick.pRaw) return b.pick.pRaw - a.pick.pRaw;
    return kickoffMs(a.fixture.kickoffIso) - kickoffMs(b.fixture.kickoffIso);
  });

  const { count, insufficientPool } = selectWeekendPickCount(scored.length);
  const top = scored.slice(0, count);

  const rows: WeekendOpportunityRow[] = top.map(({ fixture, estimate, pick }, idx) => ({
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
    },
  }));

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
