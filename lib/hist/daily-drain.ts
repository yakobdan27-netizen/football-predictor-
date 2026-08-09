/**
 * Daily hist inventory drain — gap-priority, deep-first.
 * Used by cron; stops on quota, gate pass, or max chunks.
 */
import {
  auditHistCoverage,
  gapQueueFromCoverage,
} from "./coverage-audit";
import { runHistBackfillChunk } from "./backfill";
import type { HistBackfillChunkSummary } from "./backfill";

export type DailyDrainResult = {
  ok: boolean;
  gatePass: boolean;
  inventoryPass: number;
  total: number;
  providerHoles: number;
  chunksAttempted: number;
  totalEnriched: number;
  stoppedReason:
    | "gate_pass"
    | "quota"
    | "done"
    | "max_chunks"
    | "error"
    | "no_gaps";
  lastChunk: HistBackfillChunkSummary | null;
  error?: string;
};

async function refitHalfParamsIfNeeded(
  totalEnriched: number,
  invBefore: number,
  invAfter: number
): Promise<void> {
  if (totalEnriched <= 0 && invAfter <= invBefore) return;
  try {
    const { fitAndPersistHalfParams } = await import("./fit-half-params");
    const rows = await fitAndPersistHalfParams();
    console.log(
      `[daily-drain] half-params refit: ${rows.length} leagues (DIEH ready)`
    );
  } catch (e) {
    console.warn(
      "[daily-drain] half-params refit skipped:",
      e instanceof Error ? e.message : e
    );
  }
}

/**
 * Run up to `maxChunks` gap-priority enrichments (default 1 for serverless).
 */
export async function runDailyHistDrain(opts?: {
  maxChunks?: number;
}): Promise<DailyDrainResult> {
  const maxChunks = Math.max(1, Math.min(20, opts?.maxChunks ?? 1));
  let totalEnriched = 0;
  let lastChunk: HistBackfillChunkSummary | null = null;
  let chunksAttempted = 0;

  const before = await auditHistCoverage();
  const inv0 = before.summary.inventoryPass;
  if (inv0 >= before.summary.total) {
    return {
      ok: true,
      gatePass: true,
      inventoryPass: inv0,
      total: before.summary.total,
      providerHoles: before.summary.providerHoles,
      chunksAttempted: 0,
      totalEnriched: 0,
      stoppedReason: "gate_pass",
      lastChunk: null,
    };
  }
  if (gapQueueFromCoverage(before).length === 0) {
    return {
      ok: true,
      gatePass: inv0 >= before.summary.total,
      inventoryPass: inv0,
      total: before.summary.total,
      providerHoles: before.summary.providerHoles,
      chunksAttempted: 0,
      totalEnriched: 0,
      stoppedReason: "no_gaps",
      lastChunk: null,
    };
  }

  for (let i = 0; i < maxChunks; i++) {
    chunksAttempted += 1;
    try {
      lastChunk = await runHistBackfillChunk({ gapPriority: true });
    } catch (e) {
      return {
        ok: false,
        gatePass: false,
        inventoryPass: inv0,
        total: before.summary.total,
        providerHoles: before.summary.providerHoles,
        chunksAttempted,
        totalEnriched,
        stoppedReason: "error",
        lastChunk,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    totalEnriched += lastChunk.enriched;

    if (lastChunk.quotaAbort || lastChunk.preflight.abort) {
      const after = await auditHistCoverage().catch(() => before);
      await refitHalfParamsIfNeeded(
        totalEnriched,
        inv0,
        after.summary.inventoryPass
      );
      return {
        ok: true,
        gatePass: after.summary.inventoryPass >= after.summary.total,
        inventoryPass: after.summary.inventoryPass,
        total: after.summary.total,
        providerHoles: after.summary.providerHoles,
        chunksAttempted,
        totalEnriched,
        stoppedReason: "quota",
        lastChunk,
      };
    }
    if (lastChunk.done) {
      const after = await auditHistCoverage().catch(() => before);
      await refitHalfParamsIfNeeded(
        totalEnriched,
        inv0,
        after.summary.inventoryPass
      );
      return {
        ok: true,
        gatePass: after.summary.inventoryPass >= after.summary.total,
        inventoryPass: after.summary.inventoryPass,
        total: after.summary.total,
        providerHoles: after.summary.providerHoles,
        chunksAttempted,
        totalEnriched,
        stoppedReason: "done",
        lastChunk,
      };
    }
    if (!lastChunk.ok && lastChunk.error) {
      // Soft-continue next cron tick; report this failure.
      const after = await auditHistCoverage().catch(() => before);
      await refitHalfParamsIfNeeded(
        totalEnriched,
        inv0,
        after.summary.inventoryPass
      );
      return {
        ok: false,
        gatePass: after.summary.inventoryPass >= after.summary.total,
        inventoryPass: after.summary.inventoryPass,
        total: after.summary.total,
        providerHoles: after.summary.providerHoles,
        chunksAttempted,
        totalEnriched,
        stoppedReason: "error",
        lastChunk,
        error: lastChunk.error,
      };
    }
  }

  const after = await auditHistCoverage().catch(() => before);

  await refitHalfParamsIfNeeded(
    totalEnriched,
    inv0,
    after.summary.inventoryPass
  );

  return {
    ok: true,
    gatePass: after.summary.inventoryPass >= after.summary.total,
    inventoryPass: after.summary.inventoryPass,
    total: after.summary.total,
    providerHoles: after.summary.providerHoles,
    chunksAttempted,
    totalEnriched,
    stoppedReason: "max_chunks",
    lastChunk,
  };
}
