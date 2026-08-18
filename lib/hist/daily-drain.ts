/**
 * Daily hist inventory drain — gap-priority, deep-first.
 * After inventory gate (66/66), switches to HT/corners enrichment phase.
 * Used by cron; stops on quota, completion, or max chunks.
 */
import {
  auditHistCoverage,
  enrichmentGapQueueFromCoverage,
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
  htFilled: number;
  cornersFilled: number;
  phase: "inventory" | "enrichment";
  enrichmentGapsRemaining: number;
  stoppedReason:
    | "gate_pass"
    | "quota"
    | "done"
    | "max_chunks"
    | "error"
    | "no_gaps"
    | "enrichment_complete";
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

function pickPhase(report: Awaited<ReturnType<typeof auditHistCoverage>>): {
  phase: "inventory" | "enrichment";
  hasWork: boolean;
  enrichmentGapsRemaining: number;
} {
  const invPass = report.summary.inventoryPass >= report.summary.total;
  const inventoryGaps = gapQueueFromCoverage(report).length;
  const enrichmentGaps = enrichmentGapQueueFromCoverage(report).length;

  if (!invPass && inventoryGaps > 0) {
    return {
      phase: "inventory",
      hasWork: true,
      enrichmentGapsRemaining: enrichmentGaps,
    };
  }
  if (enrichmentGaps > 0) {
    return {
      phase: "enrichment",
      hasWork: true,
      enrichmentGapsRemaining: enrichmentGaps,
    };
  }
  return {
    phase: invPass ? "enrichment" : "inventory",
    hasWork: false,
    enrichmentGapsRemaining: 0,
  };
}

/**
 * Run up to `maxChunks` gap-priority enrichments (default 1 for serverless).
 */
export async function runDailyHistDrain(opts?: {
  maxChunks?: number;
}): Promise<DailyDrainResult> {
  const maxChunks = Math.max(1, Math.min(20, opts?.maxChunks ?? 1));
  let totalEnriched = 0;
  let htFilled = 0;
  let cornersFilled = 0;
  let lastChunk: HistBackfillChunkSummary | null = null;
  let chunksAttempted = 0;
  let phase: "inventory" | "enrichment" = "inventory";

  const before = await auditHistCoverage();
  const inv0 = before.summary.inventoryPass;
  const initial = pickPhase(before);

  if (!initial.hasWork) {
    return {
      ok: true,
      gatePass: inv0 >= before.summary.total,
      inventoryPass: inv0,
      total: before.summary.total,
      providerHoles: before.summary.providerHoles,
      chunksAttempted: 0,
      totalEnriched: 0,
      htFilled: 0,
      cornersFilled: 0,
      phase: initial.phase,
      enrichmentGapsRemaining: 0,
      stoppedReason:
        inv0 >= before.summary.total
          ? "enrichment_complete"
          : "no_gaps",
      lastChunk: null,
    };
  }

  phase = initial.phase;

  for (let i = 0; i < maxChunks; i++) {
    const live = await auditHistCoverage().catch(() => before);
    const pick = pickPhase(live);
    phase = pick.phase;
    if (!pick.hasWork) {
      await refitHalfParamsIfNeeded(totalEnriched, inv0, live.summary.inventoryPass);
      return {
        ok: true,
        gatePass: live.summary.inventoryPass >= live.summary.total,
        inventoryPass: live.summary.inventoryPass,
        total: live.summary.total,
        providerHoles: live.summary.providerHoles,
        chunksAttempted,
        totalEnriched,
        htFilled,
        cornersFilled,
        phase,
        enrichmentGapsRemaining: 0,
        stoppedReason: "enrichment_complete",
        lastChunk,
      };
    }

    chunksAttempted += 1;
    try {
      lastChunk = await runHistBackfillChunk({
        gapPriority: true,
        mode: phase,
      });
    } catch (e) {
      return {
        ok: false,
        gatePass: false,
        inventoryPass: inv0,
        total: before.summary.total,
        providerHoles: before.summary.providerHoles,
        chunksAttempted,
        totalEnriched,
        htFilled,
        cornersFilled,
        phase,
        enrichmentGapsRemaining: pick.enrichmentGapsRemaining,
        stoppedReason: "error",
        lastChunk,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    totalEnriched += lastChunk.enriched;
    htFilled += lastChunk.htFilled;
    cornersFilled += lastChunk.cornersFilled;

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
        htFilled,
        cornersFilled,
        phase,
        enrichmentGapsRemaining:
          lastChunk.enrichmentGapsRemaining ??
          enrichmentGapQueueFromCoverage(after).length,
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
        htFilled,
        cornersFilled,
        phase,
        enrichmentGapsRemaining:
          lastChunk.enrichmentGapsRemaining ??
          enrichmentGapQueueFromCoverage(after).length,
        stoppedReason: "done",
        lastChunk,
      };
    }
    if (!lastChunk.ok && lastChunk.error) {
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
        htFilled,
        cornersFilled,
        phase,
        enrichmentGapsRemaining:
          lastChunk.enrichmentGapsRemaining ??
          enrichmentGapQueueFromCoverage(after).length,
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

  const finalPick = pickPhase(after);

  return {
    ok: true,
    gatePass: after.summary.inventoryPass >= after.summary.total,
    inventoryPass: after.summary.inventoryPass,
    total: after.summary.total,
    providerHoles: after.summary.providerHoles,
    chunksAttempted,
    totalEnriched,
    htFilled,
    cornersFilled,
    phase: finalPick.phase,
    enrichmentGapsRemaining: finalPick.enrichmentGapsRemaining,
    stoppedReason: "max_chunks",
    lastChunk,
  };
}
