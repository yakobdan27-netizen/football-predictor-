/**
 * Build API vs System record groups for the same analysis scope.
 * Unknown provenance is excluded from blend and reported.
 */

import type { PredictionBatch } from "@/lib/prediction-log/types";
import {
  classifyBatchProvenance,
  isApiGroupProvenance,
  isBlendEligible,
  isSystemGroupProvenance,
  type AnalysisProvenance,
} from "./provenance";

export type DateRange = { from: string | null; to: string | null };

export type ProvenancedRecord<T = unknown> = {
  id: string;
  provenance: AnalysisProvenance;
  date?: string | null;
  payload: T;
};

export type SourceGroupSummary = {
  recordCount: number;
  dateRange: DateRange;
  byProvenance: Partial<Record<AnalysisProvenance, number>>;
  excludedUnknown: number;
};

function emptySummary(): SourceGroupSummary {
  return {
    recordCount: 0,
    dateRange: { from: null, to: null },
    byProvenance: {},
    excludedUnknown: 0,
  };
}

function extendRange(range: DateRange, date: string | null | undefined): void {
  if (!date) return;
  if (!range.from || date < range.from) range.from = date;
  if (!range.to || date > range.to) range.to = date;
}

export function summarizeGroup<T>(
  records: ProvenancedRecord<T>[]
): SourceGroupSummary {
  const summary = emptySummary();
  for (const r of records) {
    if (!isBlendEligible(r.provenance)) {
      summary.excludedUnknown++;
      continue;
    }
    summary.recordCount++;
    summary.byProvenance[r.provenance] =
      (summary.byProvenance[r.provenance] ?? 0) + 1;
    extendRange(summary.dateRange, r.date);
  }
  return summary;
}

/**
 * Partition KV batches into system-group records (manual / bulk / …).
 * Recommended batches → unknown (excluded).
 * Dedupes by batch id.
 */
export function partitionBatchesForSystemGroup(
  batches: PredictionBatch[]
): {
  system: ProvenancedRecord<PredictionBatch>[];
  unknown: ProvenancedRecord<PredictionBatch>[];
  summary: SourceGroupSummary;
} {
  const seen = new Set<string>();
  const system: ProvenancedRecord<PredictionBatch>[] = [];
  const unknown: ProvenancedRecord<PredictionBatch>[] = [];

  for (const batch of batches) {
    if (seen.has(batch.id)) continue;
    seen.add(batch.id);
    const provenance = classifyBatchProvenance(batch);
    const rec: ProvenancedRecord<PredictionBatch> = {
      id: batch.id,
      provenance,
      date: batch.date,
      payload: batch,
    };
    if (isSystemGroupProvenance(provenance)) system.push(rec);
    else unknown.push(rec);
  }

  return {
    system,
    unknown,
    summary: summarizeGroup(system),
  };
}

/** Count finished matches in system-eligible batches (valid settled tips). */
export function countValidSystemMatchRecords(
  batches: PredictionBatch[]
): { count: number; dateRange: DateRange; unknownBatches: number } {
  const { system, unknown } = partitionBatchesForSystemGroup(batches);
  let count = 0;
  const dateRange: DateRange = { from: null, to: null };
  for (const rec of system) {
    for (const m of rec.payload.matches) {
      const filled =
        m.resultFilled === true ||
        (m.teamStats?.home?.goals != null &&
          m.teamStats?.away?.goals != null);
      if (!filled) continue;
      count++;
      extendRange(dateRange, m.matchDate ?? rec.date);
    }
  }
  return { count, dateRange, unknownBatches: unknown.length };
}

/**
 * API group placeholder summary from hist-derived sample sizes.
 * Callers pass matches_used / ess from CFE provenance (already API-side).
 */
export function apiGroupFromHistSamples(input: {
  matchesUsed: number;
  dateFrom?: string | null;
  dateTo?: string | null;
}): SourceGroupSummary {
  return {
    recordCount: Math.max(0, input.matchesUsed),
    dateRange: {
      from: input.dateFrom ?? null,
      to: input.dateTo ?? null,
    },
    byProvenance: { api_historical: Math.max(0, input.matchesUsed) },
    excludedUnknown: 0,
  };
}

/** 40% side: auto-collected 2026/27 system_season_* corpus. */
export function systemGroupFromSeasonCorpus(input: {
  matchCount: number;
  dateFrom?: string | null;
  dateTo?: string | null;
}): SourceGroupSummary {
  return {
    recordCount: Math.max(0, input.matchCount),
    dateRange: {
      from: input.dateFrom ?? null,
      to: input.dateTo ?? null,
    },
    byProvenance: { system_season_corpus: Math.max(0, input.matchCount) },
    excludedUnknown: 0,
  };
}

/**
 * Resolve system-group summary: system_season corpus when blend flag on,
 * otherwise settled KV batch matches.
 */
export async function resolveSystemGroupSummary(
  batches: PredictionBatch[],
  league?: string
): Promise<SourceGroupSummary & { unknownBatches: number }> {
  const { isSystemSeasonBlendEnabled } = await import(
    "@/lib/system-season/feature-flags"
  );
  if (isSystemSeasonBlendEnabled() && league) {
    const { apiLeagueId } = await import("@/lib/football-api/leagues");
    const { countSystemSeasonMatchRecords } = await import(
      "@/lib/system-season/store"
    );
    const leagueId = apiLeagueId(league);
    if (leagueId != null) {
      const corpus = await countSystemSeasonMatchRecords(leagueId);
      const summary = systemGroupFromSeasonCorpus({
        matchCount: corpus.count,
        dateFrom: corpus.dateFrom,
        dateTo: corpus.dateTo,
      });
      return { ...summary, unknownBatches: 0 };
    }
  }

  const systemInfo = countValidSystemMatchRecords(batches);
  return {
    recordCount: systemInfo.count,
    dateRange: systemInfo.dateRange,
    byProvenance: { manual_batch: systemInfo.count },
    excludedUnknown: systemInfo.unknownBatches,
    unknownBatches: systemInfo.unknownBatches,
  };
}

export function seedBaselineRecord<T>(
  id: string,
  payload: T,
  date?: string | null
): ProvenancedRecord<T> {
  return {
    id,
    provenance: "system_historical",
    date: date ?? null,
    payload,
  };
}

export function learnerAggregateRecord<T>(
  id: string,
  payload: T,
  date?: string | null
): ProvenancedRecord<T> {
  return {
    id,
    provenance: "ai_learner",
    date: date ?? null,
    payload,
  };
}

export function filterApiOnly<T>(
  records: ProvenancedRecord<T>[]
): ProvenancedRecord<T>[] {
  return records.filter((r) => isApiGroupProvenance(r.provenance));
}

export function filterSystemOnly<T>(
  records: ProvenancedRecord<T>[]
): ProvenancedRecord<T>[] {
  return records.filter((r) => isSystemGroupProvenance(r.provenance));
}
