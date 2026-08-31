/**
 * Daily hist inventory drain — gap-priority, deep-first.
 * After inventory gate (66/66), switches to HT/corners enrichment phase.
 * Used by cron; stops on quota, completion, deadline, or max chunks.
 */
import {
  auditHistCoverage,
  enrichmentGapQueueFromCoverage,
  gapQueueFromCoverage,
  type HistCoverageReport,
} from "./coverage-audit";
import { runHistBackfillChunk } from "./backfill";
import type { HistBackfillChunkSummary } from "./backfill";
import { runHistPreflight, type HistSyncMode } from "./preflight";

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
    | "deadline"
    | "error"
    | "no_gaps"
    | "enrichment_complete";
  syncMode?: HistSyncMode;
  lastChunk: HistBackfillChunkSummary | null;
  error?: string;
};

export type ResolveHistDrainPhaseOpts = {
  /** When true, run enrichment every 2 inventory chunks while both queues have work. */
  interleave?: boolean;
  /** Inventory chunks completed since the last enrichment chunk. */
  inventorySinceEnrich?: number;
};

export type HistDrainPhasePick = {
  phase: "inventory" | "enrichment";
  hasWork: boolean;
  enrichmentGapsRemaining: number;
};

/** Default cron chunk ceiling (override via HIST_CRON_MAX_CHUNKS). */
export const HIST_CRON_MAX_CHUNKS_DEFAULT = 3;

/** Default cron deadline ms — leaves headroom under maxDuration=60. */
export const HIST_CRON_DEADLINE_MS_DEFAULT = 52_000;

/** Inventory chunks before one interleaved enrichment chunk (2:1 ratio). */
export const HIST_INTERLEAVE_INVENTORY_RATIO = 2;

function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultOn;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "yes";
}

export function cronMaxChunksFromEnv(): number {
  const n = Number(process.env.HIST_CRON_MAX_CHUNKS);
  if (!Number.isFinite(n) || n <= 0) return HIST_CRON_MAX_CHUNKS_DEFAULT;
  return Math.max(1, Math.min(10, Math.floor(n)));
}

export function cronInterleaveEnrichmentFromEnv(): boolean {
  return envFlag("HIST_INTERLEAVE_ENRICHMENT", true);
}

/**
 * Pick inventory vs enrichment phase for the next chunk.
 * When interleave is on and inventory gaps remain, enrichment runs every
 * HIST_INTERLEAVE_INVENTORY_RATIO inventory chunks if enrichment gaps exist.
 */
export function resolveHistDrainPhase(
  report: HistCoverageReport,
  opts?: ResolveHistDrainPhaseOpts
): HistDrainPhasePick {
  const invPass = report.summary.inventoryPass >= report.summary.total;
  const inventoryGaps = gapQueueFromCoverage(report).length;
  const enrichmentGaps = enrichmentGapQueueFromCoverage(report).length;
  const interleave = opts?.interleave ?? false;
  const inventorySinceEnrich = opts?.inventorySinceEnrich ?? 0;

  if (!invPass && inventoryGaps > 0) {
    const shouldInterleave =
      interleave &&
      enrichmentGaps > 0 &&
      inventorySinceEnrich >= HIST_INTERLEAVE_INVENTORY_RATIO;
    return {
      phase: shouldInterleave ? "enrichment" : "inventory",
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

async function recomputeDerivedIfNeeded(
  totalEnriched: number,
  invBefore: number,
  invAfter: number
): Promise<void> {
  if (totalEnriched <= 0 && invAfter <= invBefore) return;
  try {
    const { recomputeDerivedFromHist } = await import("./recompute-derived");
    const result = await recomputeDerivedFromHist();
    console.log(
      `[daily-drain] derived recompute: half=${result.teamHalfStats.written} ratings=${result.teamRatings.written}`
    );
  } catch (e) {
    console.warn(
      "[daily-drain] derived recompute skipped:",
      e instanceof Error ? e.message : e
    );
  }
}

async function postDrainHooks(
  totalEnriched: number,
  invBefore: number,
  invAfter: number
): Promise<void> {
  await refitHalfParamsIfNeeded(totalEnriched, invBefore, invAfter);
  await recomputeDerivedIfNeeded(totalEnriched, invBefore, invAfter);
}

function buildResult(
  partial: Omit<DailyDrainResult, "ok"> & { ok?: boolean }
): DailyDrainResult {
  return { ok: partial.ok ?? true, ...partial };
}

/**
 * Run up to `maxChunks` gap-priority enrichments within an optional deadline.
 */
export async function runDailyHistDrain(opts?: {
  maxChunks?: number;
  deadlineMs?: number;
  interleaveEnrichment?: boolean;
}): Promise<DailyDrainResult> {
  const preflight = await runHistPreflight();
  const finish = (
    partial: Omit<DailyDrainResult, "ok"> & { ok?: boolean }
  ): DailyDrainResult =>
    buildResult({ syncMode: preflight.syncMode, ...partial });

  if (preflight.abort) {
    const before = await auditHistCoverage().catch(() => null);
    return finish({
      ok: false,
      gatePass: before
        ? before.summary.inventoryPass >= before.summary.total
        : false,
      inventoryPass: before?.summary.inventoryPass ?? 0,
      total: before?.summary.total ?? 0,
      providerHoles: before?.summary.providerHoles ?? 0,
      chunksAttempted: 0,
      totalEnriched: 0,
      htFilled: 0,
      cornersFilled: 0,
      phase: "inventory",
      enrichmentGapsRemaining: before
        ? enrichmentGapQueueFromCoverage(before).length
        : 0,
      stoppedReason: "quota",
      syncMode: preflight.syncMode,
      lastChunk: null,
      error: preflight.reason ?? "preflight abort",
    });
  }

  const envMax = Math.max(
    1,
    Math.min(20, opts?.maxChunks ?? cronMaxChunksFromEnv())
  );
  const maxChunks = Math.max(
    1,
    Math.min(envMax, preflight.recommendedMaxChunks)
  );
  const deadlineMs = opts?.deadlineMs ?? HIST_CRON_DEADLINE_MS_DEFAULT;
  const deadlineAt =
    deadlineMs > 0 ? Date.now() + deadlineMs : Number.POSITIVE_INFINITY;
  const interleave = opts?.interleaveEnrichment ?? cronInterleaveEnrichmentFromEnv();

  let totalEnriched = 0;
  let htFilled = 0;
  let cornersFilled = 0;
  let lastChunk: HistBackfillChunkSummary | null = null;
  let chunksAttempted = 0;
  let inventorySinceEnrich = 0;
  let phase: "inventory" | "enrichment" = "inventory";

  const before = await auditHistCoverage();
  const inv0 = before.summary.inventoryPass;
  const initial = resolveHistDrainPhase(before, {
    interleave,
    inventorySinceEnrich,
  });

  if (!initial.hasWork) {
    return finish({
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
        inv0 >= before.summary.total ? "enrichment_complete" : "no_gaps",
      lastChunk: null,
    });
  }

  phase = initial.phase;

  for (let i = 0; i < maxChunks; i++) {
    if (Date.now() >= deadlineAt && chunksAttempted > 0) {
      const after = await auditHistCoverage().catch(() => before);
      await postDrainHooks(
        totalEnriched,
        inv0,
        after.summary.inventoryPass
      );
      const finalPick = resolveHistDrainPhase(after, {
        interleave,
        inventorySinceEnrich,
      });
      return finish({
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
        stoppedReason: "deadline",
        lastChunk,
      });
    }

    const live = await auditHistCoverage().catch(() => before);
    const pick = resolveHistDrainPhase(live, {
      interleave,
      inventorySinceEnrich,
    });
    phase = pick.phase;
    if (!pick.hasWork) {
      await postDrainHooks(
        totalEnriched,
        inv0,
        live.summary.inventoryPass
      );
      return finish({
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
      });
    }

    chunksAttempted += 1;
    try {
      lastChunk = await runHistBackfillChunk({
        gapPriority: true,
        mode: phase,
      });
    } catch (e) {
      return finish({
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
      });
    }
    totalEnriched += lastChunk.enriched;
    htFilled += lastChunk.htFilled;
    cornersFilled += lastChunk.cornersFilled;

    if (phase === "inventory") {
      inventorySinceEnrich += 1;
    } else {
      inventorySinceEnrich = 0;
    }

    if (lastChunk.quotaAbort || lastChunk.preflight.abort) {
      const after = await auditHistCoverage().catch(() => before);
      await postDrainHooks(
        totalEnriched,
        inv0,
        after.summary.inventoryPass
      );
      return finish({
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
      });
    }
    if (lastChunk.done) {
      const after = await auditHistCoverage().catch(() => before);
      await postDrainHooks(
        totalEnriched,
        inv0,
        after.summary.inventoryPass
      );
      return finish({
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
      });
    }
    if (!lastChunk.ok && lastChunk.error) {
      const after = await auditHistCoverage().catch(() => before);
      await postDrainHooks(
        totalEnriched,
        inv0,
        after.summary.inventoryPass
      );
      return finish({
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
      });
    }

    if (Date.now() >= deadlineAt) {
      const after = await auditHistCoverage().catch(() => before);
      await postDrainHooks(
        totalEnriched,
        inv0,
        after.summary.inventoryPass
      );
      const finalPick = resolveHistDrainPhase(after, {
        interleave,
        inventorySinceEnrich,
      });
      return finish({
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
        stoppedReason: "deadline",
        lastChunk,
      });
    }
  }

  const after = await auditHistCoverage().catch(() => before);

  await postDrainHooks(
    totalEnriched,
    inv0,
    after.summary.inventoryPass
  );

  const finalPick = resolveHistDrainPhase(after, {
    interleave,
    inventorySinceEnrich,
  });

  return buildResult({
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
  });
}
