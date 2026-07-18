/**
 * Cross-batch duplicate detection for manual prediction entry.
 * Blocks same date + fixture + market + prediction (+ line) already taken elsewhere.
 */
import { apiDateOnly } from "@/lib/football-api/leagues";
import { fixturePairKey } from "@/lib/football-api/team-resolve";
import { DEFAULT_COMBO_MARKETS } from "./combo-markets-config";
import { LOG_MARKET_MAP } from "./markets-config";
import { resolveMarketMode } from "./match-entry-helpers";
import { batchMatchDay } from "./same-date-market-dedup";
import type { LogMarketKey, LogMatch, PredictionBatch } from "./types";

export interface PredictionLeg {
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
  marketKey: string;
  marketLabel: string;
  prediction: string;
  line?: number;
  odds?: number;
  occupancyKey: string;
}

export interface DuplicateHit {
  batchId: string;
  batchName: string;
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
  marketLabel: string;
  prediction: string;
  odds?: number;
  line?: number;
}

function normalizePrediction(value: string): string {
  return value.trim().toLowerCase();
}

function lineToken(line: number | undefined): string {
  if (line == null || !Number.isFinite(line)) return "";
  return String(line);
}

export function predictionOccupancyKey(params: {
  homeTeam: string;
  awayTeam: string;
  marketKey: string;
  prediction: string;
  line?: number;
}): string {
  return [
    fixturePairKey(params.homeTeam, params.awayTeam),
    params.marketKey,
    normalizePrediction(params.prediction),
    lineToken(params.line),
  ].join("|");
}

function marketLabelForKey(marketKey: string): string {
  if (marketKey === "correct_score") return "Correct score";
  if (marketKey.startsWith("combo:")) {
    const comboId = marketKey.slice("combo:".length);
    const combo = DEFAULT_COMBO_MARKETS.find((c) => c.id === comboId);
    return combo?.label ?? comboId.replace(/_/g, " ");
  }
  return LOG_MARKET_MAP[marketKey as LogMarketKey]?.label ?? marketKey;
}

function matchDayForLeg(match: LogMatch, batch: PredictionBatch, allBatches: PredictionBatch[]): string {
  if (match.matchDate) return apiDateOnly(match.matchDate);
  return batchMatchDay(batch, allBatches);
}

function legFromParts(
  match: LogMatch,
  batch: PredictionBatch,
  allBatches: PredictionBatch[],
  marketKey: string,
  prediction: string,
  opts?: { line?: number; odds?: number }
): PredictionLeg | null {
  if (!match.homeTeam || !match.awayTeam || !prediction.trim()) return null;
  const matchDate = matchDayForLeg(match, batch, allBatches);
  return {
    matchDate,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    marketKey,
    marketLabel: marketLabelForKey(marketKey),
    prediction: prediction.trim(),
    line: opts?.line,
    odds: opts?.odds,
    occupancyKey: predictionOccupancyKey({
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      marketKey,
      prediction,
      line: opts?.line,
    }),
  };
}

/** Flatten all occupiable prediction legs from a batch (entry + recommended). */
export function extractPredictionLegs(
  batch: PredictionBatch,
  allBatches: PredictionBatch[] = []
): PredictionLeg[] {
  const legs: PredictionLeg[] = [];

  for (const match of batch.matches) {
    const mode = resolveMarketMode(match);
    if (mode === "combined" && match.comboPick?.comboId) {
      const leg = legFromParts(
        match,
        batch,
        allBatches,
        `combo:${match.comboPick.comboId}`,
        match.comboPick.comboId,
        { odds: match.comboPick.odds }
      );
      if (leg) legs.push(leg);
    } else {
      for (const [key, pick] of Object.entries(match.predictions)) {
        if (!pick?.prediction) continue;
        const leg = legFromParts(match, batch, allBatches, key, pick.prediction, {
          line: pick.line,
          odds: pick.odds,
        });
        if (leg) legs.push(leg);
      }
    }

    if (match.correctScorePick) {
      const cs = match.correctScorePick;
      const leg = legFromParts(
        match,
        batch,
        allBatches,
        "correct_score",
        `${cs.home}-${cs.away}`,
        { odds: cs.odds }
      );
      if (leg) legs.push(leg);
    }
  }

  for (const match of batch.recommended?.matches ?? []) {
    for (const [key, pick] of Object.entries(match.predictions)) {
      if (!pick || pick.action === "remove" || !pick.prediction) continue;
      const asLog: LogMatch = {
        id: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        predictions: {},
        actualResults: {},
        scored: {},
      };
      const leg = legFromParts(asLog, batch, allBatches, key, pick.prediction, {
        line: pick.line,
        odds: pick.odds,
      });
      if (leg) legs.push(leg);
    }
  }

  return legs;
}

export function findCrossBatchDuplicates(params: {
  incomingBatch: PredictionBatch;
  allBatches: PredictionBatch[];
  excludeBatchId?: string;
}): DuplicateHit[] {
  const { incomingBatch, allBatches, excludeBatchId } = params;
  const incomingLegs = extractPredictionLegs(incomingBatch, allBatches);
  if (incomingLegs.length === 0) return [];

  const incomingDays = new Set(incomingLegs.map((l) => l.matchDate));
  const occupied = new Map<string, DuplicateHit>();

  for (const batch of allBatches) {
    if (batch.id === incomingBatch.id) continue;
    if (excludeBatchId && batch.id === excludeBatchId) continue;

    const priorLegs = extractPredictionLegs(batch, allBatches);
    for (const leg of priorLegs) {
      if (!incomingDays.has(leg.matchDate)) continue;
      const dayKey = `${leg.matchDate}|${leg.occupancyKey}`;
      if (!occupied.has(dayKey)) {
        occupied.set(dayKey, {
          batchId: batch.id,
          batchName: batch.batchName,
          matchDate: leg.matchDate,
          homeTeam: leg.homeTeam,
          awayTeam: leg.awayTeam,
          marketLabel: leg.marketLabel,
          prediction: leg.prediction,
          odds: leg.odds,
          line: leg.line,
        });
      }
    }
  }

  const hits: DuplicateHit[] = [];
  const seen = new Set<string>();
  for (const leg of incomingLegs) {
    const dayKey = `${leg.matchDate}|${leg.occupancyKey}`;
    const hit = occupied.get(dayKey);
    if (!hit) continue;
    const dedupe = `${hit.batchId}|${dayKey}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    hits.push(hit);
  }
  return hits;
}
