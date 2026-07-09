import { fitBinCalibrator, type BinCalibrator } from "@/lib/predictor/calibration";
import { BAYESIAN_CONFIG } from "./bayesian-config";
import {
  tightenBetaPrior,
  tightenGammaPrior,
} from "./bayesian-update";
import type { ClubRecord, GammaPosterior, BetaPosterior } from "./club-record-types";
import { KV_KEYS } from "./kv-keys";
import { getJson, setJson } from "./kv";
import { loadClubRecord, saveClubRecord } from "./club-store";
import type { LogMarketKey, PredictionBatch } from "./types";

export interface BayesianCalibrationEntry {
  predicted: number;
  actualHit: boolean;
  marketKey: LogMarketKey;
  intervalWidth: number;
  batchId: string;
  matchId: string;
  clubId?: string;
  recordedAt: string;
}

export interface BayesianCalibrationLog {
  entries: BayesianCalibrationEntry[];
  version: 1;
}

export function emptyCalibrationLog(): BayesianCalibrationLog {
  return { entries: [], version: 1 };
}

export async function loadBayesianCalibrationLog(): Promise<BayesianCalibrationLog> {
  const stored = await getJson<BayesianCalibrationLog>(KV_KEYS.bayesianCalibrationLog);
  return stored ?? emptyCalibrationLog();
}

export async function saveBayesianCalibrationLog(log: BayesianCalibrationLog): Promise<void> {
  await setJson(KV_KEYS.bayesianCalibrationLog, log);
}

export async function recordBayesianCalibration(
  entry: Omit<BayesianCalibrationEntry, "recordedAt">
): Promise<void> {
  const log = await loadBayesianCalibrationLog();
  log.entries.push({ ...entry, recordedAt: new Date().toISOString() });
  if (log.entries.length > 5000) {
    log.entries = log.entries.slice(-4000);
  }
  await saveBayesianCalibrationLog(log);
}

export function buildCalibratorFromLog(log: BayesianCalibrationLog): BinCalibrator | null {
  if (log.entries.length < 20) return null;
  const predicted = log.entries.map((e) => e.predicted);
  const actual = log.entries.map((e) => (e.actualHit ? 1 : 0));
  return fitBinCalibrator(predicted, actual, 10, 5);
}

export async function tightenClubPriorsFromCalibration(
  clubId: string,
  overconfidenceFactor = 1.1
): Promise<ClubRecord | null> {
  const record = await loadClubRecord(clubId);
  if (!record?.bayesianMarkets) return null;

  const markets = { ...record.bayesianMarkets.markets };
  for (const [key, state] of Object.entries(markets)) {
    if (!state) continue;
    if (state.type === "gamma") {
      markets[key as keyof typeof markets] = tightenGammaPrior(state as GammaPosterior, overconfidenceFactor);
    } else {
      markets[key as keyof typeof markets] = tightenBetaPrior(state as BetaPosterior);
    }
  }

  const updated = {
    ...record,
    bayesianMarkets: { markets, version: 1 as const },
    lastUpdated: new Date().toISOString(),
  };
  await saveClubRecord(updated);
  return updated;
}

function batchHasScoredResults(batch: PredictionBatch): boolean {
  return batch.matches.some((m) =>
    Object.values(m.scored ?? {}).some((s) => s === "correct" || s === "wrong")
  );
}

export async function maybeBayesianCalibrateOnBatch(batch: PredictionBatch): Promise<void> {
  if (!BAYESIAN_CONFIG.USE_BAYESIAN_LAYER) return;
  if (!batchHasScoredResults(batch)) return;

  const log = await loadBayesianCalibrationLog();
  const calibrator = buildCalibratorFromLog(log);
  if (!calibrator) return;

  const clubIds = new Set<string>();
  for (const m of batch.matches) {
    if (m.homeClubId) clubIds.add(m.homeClubId);
    if (m.awayClubId) clubIds.add(m.awayClubId);
  }

  let overconfidentBands = 0;
  for (const entry of log.entries.slice(-200)) {
    const scaled = entry.predicted;
    const bin = Math.min(9, Math.floor(scaled * 10));
    const scale = calibrator.scales[bin];
    if (scale != null && scale < 0.85) overconfidentBands++;
  }

  if (overconfidentBands >= 3) {
    for (const clubId of clubIds) {
      await tightenClubPriorsFromCalibration(clubId).catch(() => null);
    }
  }
}

export async function logBatchBayesianOutcomes(
  batch: PredictionBatch,
  predictions: Array<{
    matchId: string;
    marketKey: LogMarketKey;
    predicted: number;
    intervalWidth: number;
    clubId?: string;
  }>
): Promise<void> {
  for (const pred of predictions) {
    const match = batch.matches.find((m) => m.id === pred.matchId);
    if (!match) continue;
    const scored = match.scored[pred.marketKey];
    if (scored !== "correct" && scored !== "wrong") continue;
    await recordBayesianCalibration({
      predicted: pred.predicted,
      actualHit: scored === "correct",
      marketKey: pred.marketKey,
      intervalWidth: pred.intervalWidth,
      batchId: batch.id,
      matchId: pred.matchId,
      clubId: pred.clubId,
    });
  }
}
