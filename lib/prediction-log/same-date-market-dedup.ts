import { apiDateOnly } from "@/lib/football-api/leagues";
import { fixturePairKey } from "@/lib/football-api/team-resolve";
import type { ScoredMatchCandidate } from "./match-risk-score";
import type { LogMarketKey, PredictionBatch } from "./types";

export const SAME_DATE_DEDUP_PREFIX = "Already recommended in";

export function marketOccupancyKey(
  homeTeam: string,
  awayTeam: string,
  market: LogMarketKey
): string {
  return `${fixturePairKey(homeTeam, awayTeam)}|${market}`;
}

export function batchMatchDay(batch: PredictionBatch, allBatches: PredictionBatch[]): string {
  if (batch.sourceBatchId) {
    const source = allBatches.find((b) => b.id === batch.sourceBatchId);
    if (source) return apiDateOnly(source.date);
  }
  return apiDateOnly(batch.date);
}

function occupiedKeysFromBatch(batch: PredictionBatch): string[] {
  const keys: string[] = [];
  const matches = batch.recommended?.matches ?? [];
  for (const match of matches) {
    for (const [key, pick] of Object.entries(match.predictions)) {
      if (!pick || pick.action === "remove") continue;
      keys.push(marketOccupancyKey(match.homeTeam, match.awayTeam, key as LogMarketKey));
    }
  }
  return keys;
}

export function collectPriorOccupiedMarkets(
  sourceBatch: PredictionBatch,
  allBatches: PredictionBatch[]
): { keys: Set<string>; batchNames: string[] } {
  const matchDay = batchMatchDay(sourceBatch, allBatches);
  const keys = new Set<string>();
  const batchNames: string[] = [];

  const prior = allBatches
    .filter((batch) => {
      if (batch.id === sourceBatch.id) return false;
      if (!batch.recommended?.matches?.length) return false;
      if (batchMatchDay(batch, allBatches) !== matchDay) return false;
      return batch.createdAt < sourceBatch.createdAt;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const batch of prior) {
    for (const key of occupiedKeysFromBatch(batch)) {
      keys.add(key);
    }
    if (!batchNames.includes(batch.batchName)) {
      batchNames.push(batch.batchName);
    }
  }

  return { keys, batchNames };
}

export function occupiedFromCandidates(candidates: ScoredMatchCandidate[]): Set<string> {
  const occupied = new Set<string>();
  for (const candidate of candidates) {
    occupied.add(marketOccupancyKey(candidate.homeTeam, candidate.awayTeam, candidate.marketKey));
  }
  return occupied;
}

export function sameDateDedupReason(sourceLabel: string): string {
  return `${SAME_DATE_DEDUP_PREFIX} ${sourceLabel} (same date).`;
}

export function isSameDateDedupReason(reason: string | null | undefined): boolean {
  return reason?.startsWith(SAME_DATE_DEDUP_PREFIX) ?? false;
}

export function filterCandidatesByOccupiedMarkets(
  candidates: ScoredMatchCandidate[],
  occupied: Set<string>,
  sourceLabel?: string
): { eligible: ScoredMatchCandidate[]; removed: ScoredMatchCandidate[] } {
  if (!occupied.size) {
    return { eligible: candidates, removed: [] };
  }

  const label = sourceLabel?.trim() || "an earlier batch";
  const reason = sameDateDedupReason(label);
  const eligible: ScoredMatchCandidate[] = [];
  const removed: ScoredMatchCandidate[] = [];

  for (const candidate of candidates) {
    const key = marketOccupancyKey(candidate.homeTeam, candidate.awayTeam, candidate.marketKey);
    if (occupied.has(key)) {
      removed.push({ ...candidate, exclusionReason: reason });
    } else {
      eligible.push(candidate);
    }
  }

  return { eligible, removed };
}

export function formatSameDateDedupNotice(
  removedCount: number,
  priorBatchNames: string[]
): string {
  if (removedCount <= 0) return "";
  const source =
    priorBatchNames.length > 0 ? priorBatchNames.join(", ") : "an earlier tier";
  const marketWord = removedCount === 1 ? "market" : "markets";
  return `${removedCount} ${marketWord} removed — already recommended in ${source} (same date).`;
}
