import { executeAndSerialize } from "./run-for-fixture";
import { snapshotWeekendPicksEms } from "./ems-adapters/weekend-picks";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type {
  BestMarketPick,
  WeekendOpportunityRow,
} from "@/lib/match-centre/weekend-opportunities";
import type { MarketAdvisoryUiPayload } from "./types";
import type { AnalysisHistory, PredictionBatch } from "@/lib/prediction-log/types";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";
import type { MarketFamilyId } from "@/lib/slip-builder/types";

export function weekendPickFromRow(row: {
  marketLabel: string;
  prediction: string;
  trace: {
    family: MarketFamilyId;
    selectionKey: string;
    pRaw: number;
    pCalibrated: number;
    nEffective: number;
    coherenceOk: boolean;
    secondBestPCalibrated?: number;
    marketMargin?: number;
  };
}): BestMarketPick {
  return {
    marketLabel: row.marketLabel,
    predictionLabel: row.prediction,
    family: row.trace.family,
    selectionKey: row.trace.selectionKey,
    pRaw: row.trace.pRaw,
    pCalibrated: row.trace.pCalibrated,
    nEffective: row.trace.nEffective,
    coherenceOk: row.trace.coherenceOk,
    secondBestPCalibrated: row.trace.secondBestPCalibrated,
    marketMargin: row.trace.marketMargin,
  };
}

export function buildEstimateByFixtureId(
  fixtures: UpcomingFixtureRow[],
  estimates: CanonicalFixtureEstimate[]
): Map<number, CanonicalFixtureEstimate> {
  const map = new Map<number, CanonicalFixtureEstimate>();
  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i];
    const e = estimates[i];
    if (f && e) map.set(f.apiFixtureId, e);
  }
  return map;
}

export function attachWeekendAdvisories(input: {
  rows: WeekendOpportunityRow[];
  estimateByFixtureId: Map<number, CanonicalFixtureEstimate>;
  allBatches: PredictionBatch[];
  analysis: AnalysisHistory | null;
}): Record<number, MarketAdvisoryUiPayload> {
  const out: Record<number, MarketAdvisoryUiPayload> = {};
  for (const row of input.rows) {
    const cfe = input.estimateByFixtureId.get(row.apiFixtureId);
    if (!cfe) continue;
    const pick = weekendPickFromRow({
      marketLabel: row.marketLabel,
      prediction: row.prediction,
      trace: row.trace,
    });
    const { ui } = executeAndSerialize({
      fixtureId: row.apiFixtureId,
      matchId: String(row.apiFixtureId),
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      league: row.league,
      kickoffIso: row.kickoffIso,
      cfe,
      emsSnapshot: snapshotWeekendPicksEms(pick),
      emsKind: "weekend_picks",
      allBatches: input.allBatches,
      analysis: input.analysis,
      persist: true,
    });
    out[row.apiFixtureId] = ui;
  }
  return out;
}
