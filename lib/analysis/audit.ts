/**
 * Optional append-only audit for blended analysis runs.
 * Never mutates legacy hist/KV stores.
 */

import { getDb } from "@/lib/db";
import { coreAnalysisRun } from "@/lib/db/schema";
import type { BlendedPayload } from "./blended-analysis-service";

export type AnalysisRunAudit = {
  pageId: string;
  mode: "legacy" | "blended";
  configuredApiWeight: number;
  configuredSystemWeight: number;
  effectiveApiWeight: number;
  effectiveSystemWeight: number;
  apiRecordCount: number;
  systemRecordCount: number;
  apiDateFrom: string | null;
  apiDateTo: string | null;
  systemDateFrom: string | null;
  systemDateTo: string | null;
  calculationVersion: string;
  status: string;
  fallbackReason: string | null;
  warningsJson: string;
  metaJson?: string | null;
};

/** Best-effort write; never throws into analysis path. */
export async function writeAnalysisRunAudit(
  row: AnalysisRunAudit
): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(coreAnalysisRun).values({
      pageId: row.pageId,
      mode: row.mode,
      configuredApiWeight: row.configuredApiWeight,
      configuredSystemWeight: row.configuredSystemWeight,
      effectiveApiWeight: row.effectiveApiWeight,
      effectiveSystemWeight: row.effectiveSystemWeight,
      apiRecordCount: row.apiRecordCount,
      systemRecordCount: row.systemRecordCount,
      apiDateFrom: row.apiDateFrom,
      apiDateTo: row.apiDateTo,
      systemDateFrom: row.systemDateFrom,
      systemDateTo: row.systemDateTo,
      calculationVersion: row.calculationVersion,
      status: row.status,
      fallbackReason: row.fallbackReason,
      warningsJson: row.warningsJson,
      metaJson: row.metaJson ?? null,
      createdAt: new Date(),
    });
  } catch (e) {
    console.warn(
      "[blended-analysis-audit] write failed:",
      e instanceof Error ? e.message : e
    );
  }
}

export function auditFromBlendedPayload(
  pageId: string,
  blended: BlendedPayload<Record<string, number | null | undefined>>
): AnalysisRunAudit {
  return {
    pageId,
    mode: shouldMode(blended),
    configuredApiWeight: blended.sourceBreakdown.api.configuredWeight,
    configuredSystemWeight: blended.sourceBreakdown.system.configuredWeight,
    effectiveApiWeight: blended.sourceBreakdown.api.effectiveWeight,
    effectiveSystemWeight: blended.sourceBreakdown.system.effectiveWeight,
    apiRecordCount: blended.sourceBreakdown.api.recordCount,
    systemRecordCount: blended.sourceBreakdown.system.recordCount,
    apiDateFrom: blended.sourceBreakdown.api.dateRange.from,
    apiDateTo: blended.sourceBreakdown.api.dateRange.to,
    systemDateFrom: blended.sourceBreakdown.system.dateRange.from,
    systemDateTo: blended.sourceBreakdown.system.dateRange.to,
    calculationVersion: blended.calculationVersion,
    status: blended.status,
    fallbackReason: blended.fallbackReason,
    warningsJson: JSON.stringify(blended.quality.warnings),
  };
}

function shouldMode(
  blended: BlendedPayload<Record<string, number | null | undefined>>
): "legacy" | "blended" {
  if (!blended.enabled) return "legacy";
  if (blended.status === "complete") return "blended";
  return "legacy";
}
