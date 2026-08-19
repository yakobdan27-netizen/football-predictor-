/**
 * Batch-level API result fill for Prediction Log (replaces Livescore scrape fill).
 */
import { loadBatch, saveBatch, loadAllBatches } from "@/lib/prediction-log/club-store";
import { syncBatchToClubHistories } from "@/lib/prediction-log/club-history-writer";
import { maybeRetrainOnBatchResult } from "@/lib/prediction-log/retrain-ml";
import { maybeBayesianCalibrateOnBatch } from "@/lib/prediction-log/bayesian-calibration";
import { computeLeagueBaselines } from "@/lib/prediction-log/league-baselines";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { recomputeAndPersistLearnerStats } from "@/lib/prediction-log/learner-stats-store";
import { recomputeAndPersistLeaguePriors } from "@/lib/prediction-log/league-priors-store";
import { recomputePlSeasonCards } from "@/lib/prediction-log/pl-season-store";
import { recomputeLlSeasonCards } from "@/lib/prediction-log/ll-season-store";
import { recomputeBlSeasonCards } from "@/lib/prediction-log/bl-season-store";
import { recomputeSaSeasonCards } from "@/lib/prediction-log/sa-season-store";
import { recomputeL1SeasonCards } from "@/lib/prediction-log/l1-season-store";
import {
  scoreBatch,
  marketsEnteredCount,
} from "@/lib/prediction-log/scoring";
import {
  migrateMatchTraceState,
} from "@/lib/prediction-log/result-trace";
import type { LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { isApiFootballKeyError, sleep } from "./client";
import { matchNeedsApiDetailFill } from "./map-fixture-to-match";
import {
  enrichMatchFromApi,
  traceMatchResult,
} from "./trace-fixture-by-pair";

const MAX_MATCHES_PER_REQUEST = 5;
const TIME_BUDGET_MS = 50_000;

export interface SyncBatchFromApiSummary {
  filled: number;
  enriched: number;
  failed: number;
  remaining: string[];
  errors: string[];
  unavailable?: boolean;
  batch?: PredictionBatch;
}

function batchDateIsPastOrToday(date: string): boolean {
  const digits = date.replace(/[^0-9]/g, "");
  let ymd = "";
  if (/^\d{4}-\d{2}-\d{2}/.test(date.trim())) {
    ymd = date.trim().slice(0, 10).replace(/-/g, "");
  } else if (digits.length >= 8) {
    ymd = digits.slice(0, 8);
  } else {
    return true;
  }
  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}`;
  return ymd <= todayKey;
}

function matchIsFilled(match: LogMatch): boolean {
  const m = migrateMatchTraceState(match);
  return m.resultFilled === true || m.resultTraceState === "FILLED";
}

export async function syncBatchFromApi(
  batchId: string,
  options?: { matchIds?: string[]; maxMatches?: number }
): Promise<SyncBatchFromApiSummary> {
  const summary: SyncBatchFromApiSummary = {
    filled: 0,
    enriched: 0,
    failed: 0,
    remaining: [],
    errors: [],
  };

  let batch: PredictionBatch;
  try {
    const loaded = await loadBatch(batchId);
    if (!loaded) {
      summary.errors.push(`Batch not found: ${batchId}`);
      return summary;
    }
    batch = loaded;
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    summary.unavailable = true;
    return summary;
  }

  if (!batchDateIsPastOrToday(batch.date)) {
    summary.errors.push("Batch date is in the future; skipping API fill.");
    summary.batch = batch;
    return summary;
  }

  const maxMatches = options?.maxMatches ?? MAX_MATCHES_PER_REQUEST;
  const idFilter = options?.matchIds?.length ? new Set(options.matchIds) : null;

  const pending = batch.matches.filter((m) => {
    if (idFilter && !idFilter.has(m.id)) return false;
    return matchNeedsApiDetailFill(m);
  });

  if (!pending.length) {
    summary.batch = batch;
    return summary;
  }

  const started = Date.now();
  let processed = 0;
  let batchChanged = false;
  const byId = new Map(batch.matches.map((m) => [m.id, m]));

  for (const match of pending) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      summary.remaining.push(match.id);
      continue;
    }
    if (processed >= maxMatches) {
      summary.remaining.push(match.id);
      continue;
    }

    processed += 1;
    const current = byId.get(match.id) ?? match;

    try {
      if (matchIsFilled(current)) {
        const result = await enrichMatchFromApi(current, batch);
        byId.set(match.id, result.match);
        batchChanged = true;
        if (result.enriched) summary.enriched += 1;
        else summary.remaining.push(match.id);
        await sleep(100);
        continue;
      }

      const traced = await traceMatchResult(current, batch);
      byId.set(match.id, traced.match);
      batchChanged = true;
      if (traced.filled) {
        summary.filled += 1;
      } else if (traced.state === "RETRY") {
        summary.remaining.push(match.id);
      } else if (
        traced.state === "AMBIGUOUS" ||
        traced.state === "NEEDS_REVIEW"
      ) {
        summary.failed += 1;
      } else if (traced.state === "FOUND_NOT_FINAL") {
        summary.remaining.push(match.id);
      }
      await sleep(100);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.failed += 1;
      summary.errors.push(`${match.homeTeam} vs ${match.awayTeam}: ${msg}`);
      if (isApiFootballKeyError(msg) || /rate|limit|quota/i.test(msg)) {
        summary.unavailable = true;
        summary.remaining.push(...pending.slice(pending.indexOf(match)).map((m) => m.id));
        break;
      }
    }
  }

  for (const m of pending) {
    const updated = byId.get(m.id) ?? m;
    if (matchNeedsApiDetailFill(updated) && !summary.remaining.includes(m.id)) {
      summary.remaining.push(m.id);
    }
  }

  if (!batchChanged) {
    summary.batch = batch;
    return summary;
  }

  const updatedMatches = batch.matches.map((m) => byId.get(m.id) ?? m);
  let updatedBatch: PredictionBatch = scoreBatch({
    ...batch,
    matches: updatedMatches,
  });
  const entered = marketsEnteredCount(updatedBatch);
  if (entered.total > 0 && entered.scored === entered.total) {
    updatedBatch = {
      ...updatedBatch,
      recommendationStatus:
        updatedBatch.batchKind === "recommended"
          ? "SETTLED"
          : updatedBatch.recommendationStatus,
      settledAt:
        updatedBatch.batchKind === "recommended"
          ? new Date().toISOString()
          : updatedBatch.settledAt,
    };
  }

  try {
    const allBatches = await loadAllBatches();
    const leagueBaselines = computeLeagueBaselines(allBatches);
    const teamsQuality = await loadTeamsQualityStore().catch(() => null);
    const synced = await syncBatchToClubHistories(updatedBatch, {
      leagueBaselines,
      teamsQuality,
    });
    await saveBatch(synced);
    await maybeRetrainOnBatchResult(synced).catch(() => null);
    await maybeBayesianCalibrateOnBatch(synced).catch(() => null);
    await recomputeAndPersistLearnerStats().catch(() => null);
    await recomputeAndPersistLeaguePriors().catch(() => null);
    await recomputePlSeasonCards().catch(() => null);
    await recomputeLlSeasonCards().catch(() => null);
    await recomputeBlSeasonCards().catch(() => null);
    await recomputeSaSeasonCards().catch(() => null);
    await recomputeL1SeasonCards().catch(() => null);
    summary.batch = synced;
  } catch (e) {
    summary.errors.push(
      `Failed to save batch: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  return summary;
}
