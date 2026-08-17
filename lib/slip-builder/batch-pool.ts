/**
 * Fixture pool from saved prediction-log batches only.
 */
import {
  estimateBatchCanonicalAsync,
  type CanonicalFixtureEstimate,
} from "@/lib/prediction-log/canonical-fixture-estimate";
import { matchLeague } from "@/lib/prediction-log/match-league";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import { HIST_LEAGUES } from "@/lib/hist/seasons";
import type { SlipPreferences } from "./types";

export type PoolFixture = {
  fixtureId: string;
  matchId: string;
  apiFixtureId: number | null;
  sourceBatchId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffIso: string;
  kickoffMs: number;
  estimate: CanonicalFixtureEstimate;
};

export const SLIP_COMPETITIONS = HIST_LEAGUES.map((l) => l.name);

function defaultWindow(): { start: string; end: string } {
  const now = new Date();
  const start = now.toISOString().slice(0, 10);
  const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

export function resolveWindow(prefs: SlipPreferences): {
  start: string;
  end: string;
} {
  if (prefs.windowStart && prefs.windowEnd) {
    return { start: prefs.windowStart, end: prefs.windowEnd };
  }
  return defaultWindow();
}

/** Match date span for a saved prediction batch (all matches included). */
export function windowForPredictionBatch(batch: PredictionBatch): {
  start: string;
  end: string;
} {
  const start = batch.date.slice(0, 10);
  let end = start;
  for (const match of batch.matches) {
    const d = (match.matchDate ?? batch.date).slice(0, 10);
    if (d > end) end = d;
  }
  return { start, end };
}

function dateInWindow(dateIso: string, start: string, end: string): boolean {
  const d = dateIso.slice(0, 10);
  return d >= start && d <= end;
}

/**
 * Flatten + dedupe matches from saved batches, compute CFE once per fixture.
 */
export async function loadBatchFixturePool(
  allBatches: PredictionBatch[],
  prefs: SlipPreferences,
  opts?: {
    excludeFixtureIds?: string[];
  }
): Promise<PoolFixture[]> {
  const batchScoped = Boolean(prefs.sourceBatchId?.trim());
  const { start, end } = batchScoped
    ? { start: "", end: "" }
    : resolveWindow(prefs);
  const comps =
    prefs.competitions.length > 0
      ? new Set(prefs.competitions)
      : new Set(SLIP_COMPETITIONS);
  const exclude = new Set(opts?.excludeFixtureIds ?? []);

  const batchesToScan = prefs.sourceBatchId?.trim()
    ? allBatches.filter((b) => b.id === prefs.sourceBatchId)
    : allBatches;

  type Raw = {
    fixtureId: string;
    matchId: string;
    apiFixtureId: number | null;
    sourceBatchId: string;
    homeTeam: string;
    awayTeam: string;
    competition: string;
    kickoffIso: string;
    kickoffMs: number;
    batch: PredictionBatch;
    matchIndex: number;
  };

  const byKey = new Map<string, Raw>();

  for (const batch of batchesToScan) {
    for (let i = 0; i < batch.matches.length; i++) {
      const match = batch.matches[i]!;
      const competition = matchLeague(match, batch.league);
      if (!comps.has(competition)) continue;
      const kickoffIso = match.matchDate ?? batch.date;
      if (
        !batchScoped &&
        !dateInWindow(kickoffIso, start, end)
      ) {
        continue;
      }
      const fixtureId =
        match.apiFixtureId != null
          ? `api:${match.apiFixtureId}`
          : `match:${match.id}`;
      if (exclude.has(fixtureId) || exclude.has(match.id)) continue;
      const kickoffMs = Date.parse(kickoffIso) || 0;
      const prev = byKey.get(fixtureId);
      if (prev && prev.kickoffMs <= kickoffMs) continue;
      byKey.set(fixtureId, {
        fixtureId,
        matchId: match.id,
        apiFixtureId: match.apiFixtureId ?? null,
        sourceBatchId: batch.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        competition,
        kickoffIso,
        kickoffMs,
        batch,
        matchIndex: i,
      });
    }
  }

  // Group by source batch for efficient CFE estimation
  const byBatch = new Map<string, Raw[]>();
  for (const row of byKey.values()) {
    const list = byBatch.get(row.sourceBatchId) ?? [];
    list.push(row);
    byBatch.set(row.sourceBatchId, list);
  }

  const batchById = new Map(allBatches.map((b) => [b.id, b]));
  const out: PoolFixture[] = [];

  for (const [batchId, rows] of byBatch) {
    const batch = batchById.get(batchId);
    if (!batch) continue;
    // Build a slim batch of only needed matches preserving order for estimateBatchCanonical
    const needed = new Set(rows.map((r) => r.matchId));
    const shelled: PredictionBatch = {
      ...batch,
      matches: batch.matches.filter((m) => needed.has(m.id)),
    };
    const estimates = await estimateBatchCanonicalAsync(shelled, allBatches);
    const estByMatch = new Map<string, CanonicalFixtureEstimate>();
    for (let i = 0; i < shelled.matches.length; i++) {
      estByMatch.set(shelled.matches[i]!.id, estimates[i]!);
    }
    for (const row of rows) {
      const estimate = estByMatch.get(row.matchId);
      if (!estimate) continue;
      out.push({
        fixtureId: row.fixtureId,
        matchId: row.matchId,
        apiFixtureId: row.apiFixtureId,
        sourceBatchId: row.sourceBatchId,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        competition: row.competition,
        kickoffIso: row.kickoffIso,
        kickoffMs: row.kickoffMs,
        estimate,
      });
    }
  }

  out.sort((a, b) => a.kickoffMs - b.kickoffMs);
  return out;
}
