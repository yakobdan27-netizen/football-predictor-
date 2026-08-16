"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadClubRecordsForBatchFromCache } from "@/lib/prediction-log/storage";
import type { ClubIndex, ClubRecord } from "@/lib/prediction-log/club-record-types";
import type { MatchLineups, PredictionBatch } from "@/lib/prediction-log/types";
import {
  buildFormationReference,
  type FormationReference,
} from "@/lib/upcoming/formation-reference";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";

export function useUpcomingFormationReferences(
  batch: PredictionBatch | null,
  fixtures: UpcomingFixtureRow[],
  clubIndex: ClubIndex | null,
  ready: boolean
): {
  references: FormationReference[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  lineupsByFixtureId: Record<number, MatchLineups | null>;
} {
  const [clubRecords, setClubRecords] = useState<Record<string, ClubRecord>>({});
  const [lineupsByFixtureId, setLineupsByFixtureId] = useState<
    Record<number, MatchLineups | null>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fixtureByApiId = useMemo(() => {
    const m = new Map<number, UpcomingFixtureRow>();
    for (const f of fixtures) m.set(f.apiFixtureId, f);
    return m;
  }, [fixtures]);

  const load = useCallback(async () => {
    if (!batch || !ready) return;
    setLoading(true);
    setError(null);
    try {
      const records = await loadClubRecordsForBatchFromCache(batch);
      setClubRecords(records);

      const payload = batch.matches
        .filter((m) => m.apiFixtureId != null)
        .map((m) => ({
          fixtureId: m.apiFixtureId!,
          homeTeamId: m.homeApiTeamId ?? null,
          awayTeamId: m.awayApiTeamId ?? null,
        }));

      let byId: Record<number, MatchLineups | null> = {};
      if (payload.length) {
        const res = await fetch("/api/fixtures/lineups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fixtures: payload }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          lineupsByFixtureId?: Record<number, MatchLineups | null>;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? "Could not load lineups");
        }
        byId = data.lineupsByFixtureId ?? {};
      }
      setLineupsByFixtureId(byId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Formation trace failed");
    } finally {
      setLoading(false);
    }
  }, [batch, ready]);

  useEffect(() => {
    void load();
  }, [load]);

  const references = useMemo(() => {
    if (!batch) return [] as FormationReference[];
    return batch.matches
      .filter((m) => m.apiFixtureId != null)
      .map((m) => {
        const fx = fixtureByApiId.get(m.apiFixtureId!);
        return buildFormationReference(m, batch.league, {
          apiLineups: lineupsByFixtureId[m.apiFixtureId!] ?? null,
          clubIndex,
          clubRecords,
          kickoff: fx?.kickoffIso,
        });
      });
  }, [batch, clubIndex, clubRecords, lineupsByFixtureId, fixtureByApiId]);

  return { references, loading, error, refresh: load, lineupsByFixtureId };
}
