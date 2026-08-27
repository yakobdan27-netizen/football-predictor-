/**
 * Build an in-memory PredictionBatch from Weekend Picks API rows.
 */
import type { WeekendOpportunityRow } from "@/lib/match-centre/weekend-opportunities";
import { deriveBatchDateFromMatches } from "./batch-date";
import { defaultCombinedOddsSettings } from "./combo-settings";
import { deriveBatchLeague } from "./match-league";
import type { LogMatch, PredictionBatch } from "./types";

function kickoffMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** Dedupe by apiFixtureId, earliest kickoff first. */
export function sortDedupeWeekendRows(
  rows: WeekendOpportunityRow[]
): WeekendOpportunityRow[] {
  const sorted = [...rows].sort(
    (a, b) => kickoffMs(a.kickoffIso) - kickoffMs(b.kickoffIso)
  );
  const seen = new Set<number>();
  const out: WeekendOpportunityRow[] = [];
  for (const row of sorted) {
    if (seen.has(row.apiFixtureId)) continue;
    seen.add(row.apiFixtureId);
    out.push(row);
  }
  return out;
}

export function buildWeekendPicksBatchFromRows(
  rows: WeekendOpportunityRow[],
  opts?: { batchId?: string }
): PredictionBatch | null {
  const deduped = sortDedupeWeekendRows(rows);
  if (deduped.length === 0) return null;

  const settings = defaultCombinedOddsSettings();
  const batchDate = deriveBatchDateFromMatches(
    deduped.map((r) => ({ matchDate: r.kickoffIso.slice(0, 10) }))
  );
  const batchId = opts?.batchId ?? `WEEKEND-${batchDate}`;

  const matches: LogMatch[] = deduped.map((row, i) => ({
    id: `${batchId}-m${i + 1}`,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    league: row.league,
    matchDate: row.kickoffIso.slice(0, 10),
    apiFixtureId: row.apiFixtureId,
    fixtureStatus: "NS",
    predictions: {},
    actualResults: {},
    scored: {},
    marketMode: settings.defaultMarketMode,
  }));

  return {
    id: batchId,
    date: batchDate,
    league: deriveBatchLeague(matches),
    batchName: "Weekend Picks (API)",
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    source: "web",
    matches,
  };
}
