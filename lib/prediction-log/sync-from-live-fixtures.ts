/**
 * Merge finished Match Centre live_fixtures into Prediction Log batches (non-destructive).
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { liveFixtures, matchStats, type MatchStats } from "@/lib/db/schema";
import { LIVE_STATUSES } from "@/lib/live/constants";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { matchNeedsApiDetailFill } from "@/lib/football-api/map-fixture-to-match";
import { migrateMatchTraceState } from "@/lib/prediction-log/result-trace";
import { scoreMatch } from "@/lib/prediction-log/scoring";
import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import type {
  LogMatch,
  PredictionBatch,
  TeamSideStats,
} from "@/lib/prediction-log/types";
import {
  persistUpdatedBatch,
  scoreBatchWithUpdatedMatches,
} from "@/lib/football-api/sync-batch-persist";

export type SyncFromLiveFixturesSummary = {
  updatedBatches: number;
  matchesMerged: number;
  errors: string[];
  archivedBatchIds: string[];
};

type LiveRow = typeof liveFixtures.$inferSelect;

function setIfEmpty(
  side: TeamSideStats,
  field: keyof TeamSideStats,
  value: number | undefined
): void {
  if (value == null || !Number.isFinite(value)) return;
  if (side[field] != null) return;
  side[field] = value;
}

function hasManualFt(match: LogMatch): boolean {
  return (
    match.resultSource === "manual" &&
    match.teamStats?.home?.goals != null &&
    match.teamStats?.away?.goals != null
  );
}

/** Non-destructive merge of live DB scores/stats into a batch match. */
export function mergeLiveDataIntoMatch(
  match: LogMatch,
  live: LiveRow,
  stats: MatchStats | null
): LogMatch {
  const base = migrateMatchTraceState(match);
  if (hasManualFt(base)) return base;

  const homeGoals = live.homeGoals;
  const awayGoals = live.awayGoals;
  if (homeGoals == null || awayGoals == null) return base;

  const home: TeamSideStats = { ...(base.teamStats?.home ?? {}) };
  const away: TeamSideStats = { ...(base.teamStats?.away ?? {}) };

  setIfEmpty(home, "goals", homeGoals);
  setIfEmpty(away, "goals", awayGoals);
  setIfEmpty(home, "corners", live.homeCorners ?? stats?.homeCorners ?? undefined);
  setIfEmpty(away, "corners", live.awayCorners ?? stats?.awayCorners ?? undefined);
  setIfEmpty(home, "totalShots", live.homeShots ?? stats?.homeShots ?? undefined);
  setIfEmpty(away, "totalShots", live.awayShots ?? stats?.awayShots ?? undefined);
  setIfEmpty(
    home,
    "shotsOnTarget",
    stats?.homeShotsOnTarget ?? undefined
  );
  setIfEmpty(
    away,
    "shotsOnTarget",
    stats?.awayShotsOnTarget ?? undefined
  );
  setIfEmpty(
    home,
    "possession",
    live.homePossession ?? stats?.homePossession ?? undefined
  );
  setIfEmpty(
    away,
    "possession",
    live.awayPossession ?? stats?.awayPossession ?? undefined
  );
  setIfEmpty(home, "fouls", stats?.homeFouls ?? undefined);
  setIfEmpty(away, "fouls", stats?.awayFouls ?? undefined);
  setIfEmpty(home, "yellowCards", stats?.homeYellowCards ?? undefined);
  setIfEmpty(away, "yellowCards", stats?.awayYellowCards ?? undefined);
  setIfEmpty(home, "redCards", stats?.homeRedCards ?? undefined);
  setIfEmpty(away, "redCards", stats?.awayRedCards ?? undefined);

  let merged: LogMatch = {
    ...base,
    apiFixtureId: base.apiFixtureId ?? live.fixtureId,
    fixtureStatus: live.status ?? base.fixtureStatus,
    resultSource: base.resultSource ?? "api-football",
    resultFilled: true,
    resultTraceState: "FILLED",
    teamStats: {
      ...(base.teamStats ?? { home: {}, away: {} }),
      home,
      away,
    },
  };
  merged = applyTeamStatsSync(merged);
  merged = scoreMatch(merged);
  return merged;
}

async function listRecentlyFinishedLiveRows(
  hoursBack = 48
): Promise<Array<{ live: LiveRow; stats: MatchStats | null }>> {
  const db = await getDb();
  const since = new Date(Date.now() - hoursBack * 60 * 60_000);
  const finished = [...LIVE_STATUSES.finished];
  const rows = await db
    .select()
    .from(liveFixtures)
    .where(
      and(
        inArray(liveFixtures.status, finished),
        gte(liveFixtures.kickoffUtc, since)
      )
    );

  const out: Array<{ live: LiveRow; stats: MatchStats | null }> = [];
  for (const live of rows) {
    const statRows = await db
      .select()
      .from(matchStats)
      .where(eq(matchStats.fixtureId, live.fixtureId))
      .limit(1);
    out.push({ live, stats: statRows[0] ?? null });
  }
  return out;
}

export async function syncPredictionLogFromLiveFixtures(opts?: {
  batchId?: string;
  hoursBack?: number;
}): Promise<SyncFromLiveFixturesSummary> {
  const summary: SyncFromLiveFixturesSummary = {
    updatedBatches: 0,
    matchesMerged: 0,
    errors: [],
    archivedBatchIds: [],
  };

  let batches: PredictionBatch[];
  try {
    batches = await loadAllBatches();
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    return summary;
  }

  if (opts?.batchId) {
    batches = batches.filter((b) => b.id === opts.batchId);
  }

  const byFixtureId = new Map<number, Array<{ batch: PredictionBatch; match: LogMatch }>>();
  for (const batch of batches) {
    for (const match of batch.matches) {
      const fid = match.apiFixtureId;
      if (fid == null) continue;
      if (!matchNeedsApiDetailFill(match)) continue;
      const list = byFixtureId.get(fid) ?? [];
      list.push({ batch, match });
      byFixtureId.set(fid, list);
    }
  }

  if (!byFixtureId.size) return summary;

  let liveRows: Awaited<ReturnType<typeof listRecentlyFinishedLiveRows>>;
  try {
    liveRows = await listRecentlyFinishedLiveRows(opts?.hoursBack ?? 48);
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    return summary;
  }

  const batchUpdates = new Map<
    string,
    { batch: PredictionBatch; byId: Map<string, LogMatch> }
  >();

  for (const { live, stats } of liveRows) {
    const targets = byFixtureId.get(live.fixtureId);
    if (!targets?.length) continue;

    for (const { batch, match } of targets) {
      const merged = mergeLiveDataIntoMatch(match, live, stats);
      if (JSON.stringify(merged) === JSON.stringify(match)) continue;

      let state = batchUpdates.get(batch.id);
      if (!state) {
        state = {
          batch,
          byId: new Map(batch.matches.map((m) => [m.id, m])),
        };
        batchUpdates.set(batch.id, state);
      }
      state.byId.set(match.id, merged);
      summary.matchesMerged += 1;
    }
  }

  if (!batchUpdates.size) return summary;

  try {
    for (const state of batchUpdates.values()) {
      const updatedBatch = scoreBatchWithUpdatedMatches(
        state.batch,
        state.batch.matches.map((m) => state.byId.get(m.id) ?? m)
      );
      const { archived } = await persistUpdatedBatch(updatedBatch);
      summary.updatedBatches += 1;
      if (archived) summary.archivedBatchIds.push(state.batch.id);
    }
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
  }

  return summary;
}
