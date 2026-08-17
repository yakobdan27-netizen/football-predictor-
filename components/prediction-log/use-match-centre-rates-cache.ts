"use client";

import { useEffect, useMemo, useState } from "react";
import { collectBatchTeamLeaguePairs } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { ClubHalfAttackDefence } from "@/lib/prediction-log/hsh-half-rates";
import type { PredictionBatch } from "@/lib/prediction-log/types";

type McRatesResponse = {
  ok?: boolean;
  rates?: Record<string, ClubHalfAttackDefence>;
};

function mapFromResponse(
  rates: Record<string, ClubHalfAttackDefence> | undefined
): Map<string, ClubHalfAttackDefence> | undefined {
  if (!rates || Object.keys(rates).length === 0) return undefined;
  return new Map(Object.entries(rates));
}

/**
 * Fetch Match Centre 2026/27 half-rates for teams in a batch (client-safe).
 * Returns undefined while loading or on failure — callers fall back to prior-only API.
 */
export function useMatchCentreRatesCache(
  batch: PredictionBatch | null,
  allBatches?: PredictionBatch[]
): Map<string, ClubHalfAttackDefence> | undefined {
  const pairs = useMemo(() => {
    if (!batch) return [];
    return collectBatchTeamLeaguePairs(batch);
  }, [batch]);

  const [cache, setCache] = useState<Map<string, ClubHalfAttackDefence>>();

  useEffect(() => {
    if (!batch || pairs.length === 0) {
      setCache(undefined);
      return;
    }

    let cancelled = false;
    const byLeague = new Map<string, string[]>();
    for (const { team, league } of pairs) {
      const list = byLeague.get(league) ?? [];
      list.push(team);
      byLeague.set(league, list);
    }

    async function load() {
      const merged = new Map<string, ClubHalfAttackDefence>();
      try {
        for (const [league, teams] of byLeague) {
          const qs = new URLSearchParams({
            league,
            teams: [...new Set(teams)].join(","),
          });
          const res = await fetch(`/api/match-centre/team-half-rates?${qs}`);
          if (!res.ok) continue;
          const data = (await res.json()) as McRatesResponse;
          const map = mapFromResponse(data.rates);
          if (!map) continue;
          for (const [k, v] of map) merged.set(k, v);
        }
        if (!cancelled) {
          setCache(merged.size > 0 ? merged : undefined);
        }
      } catch {
        if (!cancelled) setCache(undefined);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [batch, pairs, allBatches]);

  return cache;
}

/**
 * Imperative fetch for non-hook callers (e.g. combo batch prep).
 */
export async function fetchMatchCentreRatesCache(
  batch: PredictionBatch
): Promise<Map<string, ClubHalfAttackDefence> | undefined> {
  const pairs = collectBatchTeamLeaguePairs(batch);
  if (!pairs.length) return undefined;

  const byLeague = new Map<string, string[]>();
  for (const { team, league } of pairs) {
    const list = byLeague.get(league) ?? [];
    list.push(team);
    byLeague.set(league, list);
  }

  const merged = new Map<string, ClubHalfAttackDefence>();
  for (const [league, teams] of byLeague) {
    const qs = new URLSearchParams({
      league,
      teams: [...new Set(teams)].join(","),
    });
    try {
      const res = await fetch(`/api/match-centre/team-half-rates?${qs}`);
      if (!res.ok) continue;
      const data = (await res.json()) as McRatesResponse;
      const map = mapFromResponse(data.rates);
      if (!map) continue;
      for (const [k, v] of map) merged.set(k, v);
    } catch {
      continue;
    }
  }
  return merged.size > 0 ? merged : undefined;
}
