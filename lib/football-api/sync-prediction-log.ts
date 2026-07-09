import { loadAllBatches, saveBatch } from "@/lib/prediction-log/club-store";
import { syncBatchToClubHistories } from "@/lib/prediction-log/club-history-writer";
import { maybeRetrainOnBatchResult } from "@/lib/prediction-log/retrain-ml";
import { maybeBayesianCalibrateOnBatch } from "@/lib/prediction-log/bayesian-calibration";
import { computeLeagueBaselines } from "@/lib/prediction-log/league-baselines";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import { scoreMatch, scoreBatch, marketsEnteredCount } from "@/lib/prediction-log/scoring";
import type { LogMarketKey, LogMatch, PredictionBatch } from "@/lib/prediction-log/types";
import { apiFootballGet, sleep } from "./client";
import { apiDateOnly } from "./leagues";
import {
  type ApiFootballFixture,
  type ApiFootballStatBlock,
  mapFixtureToMatchUpdates,
  matchNeedsStatistics,
  mergeMatchUpdates,
} from "./map-fixture-to-match";
import { fixturePairKey } from "./team-resolve";

export interface SyncResultsSummary {
  updatedBatches: number;
  matchesSynced: number;
  matchesNotFound: number;
  errors: string[];
}

function matchNeedsSync(match: LogMatch): boolean {
  for (const key of Object.keys(match.predictions) as LogMarketKey[]) {
    const actual = match.actualResults[key]?.actual;
    const scored = match.scored[key];
    if (actual == null || (typeof actual === "string" && actual.trim() === "") || scored == null) {
      return true;
    }
  }
  return false;
}

function batchNeedsSync(batch: PredictionBatch): boolean {
  return batch.matches.some(matchNeedsSync);
}

async function fetchFixturesByDate(date: string): Promise<ApiFootballFixture[]> {
  return apiFootballGet<ApiFootballFixture[]>("/fixtures", {
    date,
    status: "FT",
  });
}

async function fetchFixtureStatistics(
  fixtureId: number
): Promise<ApiFootballStatBlock[]> {
  try {
    return await apiFootballGet<ApiFootballStatBlock[]>("/fixtures/statistics", {
      fixture: fixtureId,
    });
  } catch {
    return [];
  }
}

export function indexFixtures(fixtures: ApiFootballFixture[]): Map<string, ApiFootballFixture> {
  const map = new Map<string, ApiFootballFixture>();
  for (const f of fixtures) {
    const key = fixturePairKey(f.teams.home.name, f.teams.away.name);
    if (!map.has(key)) {
      map.set(key, f);
    }
  }
  return map;
}

export async function syncPredictionLogResults(
  batchId?: string
): Promise<SyncResultsSummary> {
  const summary: SyncResultsSummary = {
    updatedBatches: 0,
    matchesSynced: 0,
    matchesNotFound: 0,
    errors: [],
  };

  let batches = await loadAllBatches();
  if (batchId) {
    batches = batches.filter((b) => b.id === batchId);
    if (!batches.length) {
      summary.errors.push(`Batch not found: ${batchId}`);
      return summary;
    }
  }

  const pendingBatches = batches.filter(batchNeedsSync);
  if (!pendingBatches.length) return summary;

  const fixtureCache = new Map<string, Map<string, ApiFootballFixture>>();

  for (const batch of pendingBatches) {
    const date = apiDateOnly(batch.date);
    const cacheKey = date;

    if (!fixtureCache.has(cacheKey)) {
      try {
        const fixtures = await fetchFixturesByDate(date);
        fixtureCache.set(cacheKey, indexFixtures(fixtures));
      } catch (e) {
        summary.errors.push(
          `${batch.batchName} (${date}): ${e instanceof Error ? e.message : String(e)}`
        );
        continue;
      }
    }

    const fixtureIndex = fixtureCache.get(cacheKey)!;
    let batchChanged = false;
    const updatedMatches: LogMatch[] = [];

    for (const match of batch.matches) {
      if (!matchNeedsSync(match)) {
        updatedMatches.push(match);
        continue;
      }

      const key = fixturePairKey(match.homeTeam, match.awayTeam);
      const fixture = fixtureIndex.get(key);
      if (!fixture) {
        summary.matchesNotFound++;
        updatedMatches.push(match);
        continue;
      }

      let stats: ApiFootballStatBlock[] | null = null;
      if (matchNeedsStatistics(match)) {
        stats = await fetchFixtureStatistics(fixture.fixture.id);
        await sleep(200);
      }

      const updates = mapFixtureToMatchUpdates(fixture, stats, match);
      let merged = mergeMatchUpdates(match, updates);
      merged = applyTeamStatsSync(merged);
      merged = scoreMatch(merged);

      if (JSON.stringify(merged) !== JSON.stringify(match)) {
        batchChanged = true;
        summary.matchesSynced++;
      }
      updatedMatches.push(merged);
    }

    if (!batchChanged) continue;

    let updatedBatch: PredictionBatch = scoreBatch({ ...batch, matches: updatedMatches });
    const entered = marketsEnteredCount(updatedBatch);
    if (entered.total > 0 && entered.scored === entered.total) {
      updatedBatch = {
        ...updatedBatch,
        recommendationStatus:
          updatedBatch.batchKind === "recommended" ? "SETTLED" : updatedBatch.recommendationStatus,
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
      summary.updatedBatches++;
    } catch (e) {
      summary.errors.push(
        `Failed to save ${batch.batchName}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return summary;
}
