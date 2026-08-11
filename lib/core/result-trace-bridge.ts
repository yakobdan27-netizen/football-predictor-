/**
 * Bridge Prediction Log name-pair traces into core_result_trace.
 * Never settles KV batches — provenance only.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { coreFixture, coreResultTrace } from "@/lib/db/schema";
import { isCoreResultTraceWriteEnabled } from "@/lib/core/feature-flags";
import {
  coreStatusFromLogState,
  type CoreResultTraceStatus,
} from "@/lib/core/result-trace-status";
import type { LogMatch, PredictionBatch, ResultTraceState } from "@/lib/prediction-log/types";
import type { ApiFootballFixture } from "@/lib/football-api/map-fixture-to-match";

export type BridgeTraceInput = {
  batchId: string;
  match: LogMatch;
  state: ResultTraceState;
  fixture?: ApiFootballFixture | null;
  note?: string;
};

async function resolveCoreFixtureId(
  providerFixtureId: number | null | undefined
): Promise<number | null> {
  if (providerFixtureId == null) return null;
  const db = await getDb();
  const rows = await db
    .select({ id: coreFixture.id })
    .from(coreFixture)
    .where(
      and(
        eq(coreFixture.providerName, "api-sports"),
        eq(coreFixture.providerFixtureId, providerFixtureId)
      )
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Upsert a single core_result_trace row from a traced match.
 * No-ops when CORE_RESULT_TRACE_WRITE is off.
 */
export async function upsertCoreResultTrace(
  input: BridgeTraceInput
): Promise<{ wrote: boolean; status: CoreResultTraceStatus }> {
  const status = coreStatusFromLogState(input.state);
  if (!isCoreResultTraceWriteEnabled()) {
    return { wrote: false, status };
  }

  const now = new Date();
  const providerFixtureId =
    input.fixture?.fixture?.id ?? input.match.apiFixtureId ?? null;
  let coreStatus = status;
  if (
    coreStatus === "filled" ||
    (providerFixtureId != null &&
      (input.state === "FILLED" || input.state === "FOUND_NOT_FINAL"))
  ) {
    if (input.state === "FILLED") coreStatus = "filled";
    else if (input.state === "FOUND_NOT_FINAL") coreStatus = "not_final";
    else if (providerFixtureId != null && coreStatus === "pending") {
      coreStatus = "matched";
    }
  }

  const coreFixtureId = await resolveCoreFixtureId(providerFixtureId);
  const evidence = {
    resultTraceState: input.state,
    note: input.note ?? input.match.traceNote ?? null,
    providerFixtureId,
    fixtureStatus:
      input.fixture != null
        ? (input.fixture.fixture?.status?.short ?? null)
        : input.match.fixtureStatus ?? null,
    home: input.match.homeTeam,
    away: input.match.awayTeam,
    resolvedHome: input.match.resolvedHomeTeamName ?? null,
    resolvedAway: input.match.resolvedAwayTeamName ?? null,
  };

  const db = await getDb();
  const existing = await db
    .select()
    .from(coreResultTrace)
    .where(
      and(
        eq(coreResultTrace.batchId, input.batchId),
        eq(coreResultTrace.matchId, input.match.id)
      )
    )
    .limit(1);

  if (existing[0]?.status === "filled" && coreStatus !== "filled") {
    return { wrote: false, status: "filled" };
  }

  if (existing[0]) {
    await db
      .update(coreResultTrace)
      .set({
        homeTeamName: input.match.homeTeam,
        awayTeamName: input.match.awayTeam,
        matchDate: input.match.matchDate ?? null,
        status: coreStatus,
        providerFixtureId,
        coreFixtureId,
        evidenceJson: JSON.stringify(evidence),
        checkedAt: now,
        updatedAt: now,
      })
      .where(eq(coreResultTrace.id, existing[0].id));
  } else {
    await db.insert(coreResultTrace).values({
      batchId: input.batchId,
      matchId: input.match.id,
      homeTeamName: input.match.homeTeam,
      awayTeamName: input.match.awayTeam,
      matchDate: input.match.matchDate ?? null,
      status: coreStatus,
      providerFixtureId,
      coreFixtureId,
      evidenceJson: JSON.stringify(evidence),
      checkedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { wrote: true, status: coreStatus };
}

/** Best-effort bridge after a TraceMatchResult — never throws into settlement. */
export async function bridgeTraceMatchResultSafe(
  batch: PredictionBatch,
  match: LogMatch,
  state: ResultTraceState
): Promise<void> {
  try {
    await upsertCoreResultTrace({
      batchId: batch.id,
      match,
      state,
      note: match.traceNote,
    });
  } catch {
    /* core layer optional — settlement must proceed */
  }
}

/**
 * Insert pending/unresolved/not_final rows for KV batches without settling.
 */
export async function bridgePendingBatchesFromKv(
  batches: PredictionBatch[],
  opts?: { dryRun?: boolean }
): Promise<{ considered: number; wouldWrite: number; wrote: number }> {
  const pendingStates = new Set<ResultTraceState>([
    "PENDING",
    "RETRY",
    "FOUND_NOT_FINAL",
  ]);
  let considered = 0;
  let wouldWrite = 0;
  let wrote = 0;

  for (const batch of batches) {
    for (const match of batch.matches) {
      const state = match.resultTraceState ?? "PENDING";
      if (!pendingStates.has(state)) continue;
      considered++;
      wouldWrite++;
      if (opts?.dryRun) continue;
      const r = await upsertCoreResultTrace({
        batchId: batch.id,
        match,
        state,
        note: match.traceNote,
      });
      if (r.wrote) wrote++;
    }
  }

  return { considered, wouldWrite, wrote };
}
