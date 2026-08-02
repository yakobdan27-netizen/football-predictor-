"use client";

import { useEffect, useMemo, useState } from "react";
import { matchLeague } from "@/lib/prediction-log/match-league";
import {
  predictBatchTwoHHeavy,
  profileCacheKey,
  type CachedTeamHalfProfile,
  type TwoHHeavyResult,
} from "@/lib/prediction-log/two-h-heavy";
import type { PredictionBatch } from "@/lib/prediction-log/types";

function liveContextFromMatch(match: PredictionBatch["matches"][number]) {
  const status = match.fixtureStatus ?? null;
  const htH = match.teamStats?.home?.firstHalfGoals;
  const htA = match.teamStats?.away?.firstHalfGoals;
  const ftH = match.teamStats?.home?.goals;
  const ftA = match.teamStats?.away?.goals;
  if (htH == null || htA == null) return null;
  const realized_1h = htH + htA;
  let goals_2h_so_far: number | null = null;
  if (ftH != null && ftA != null) {
    goals_2h_so_far = Math.max(0, ftH + ftA - realized_1h);
  }
  return {
    statusShort: status,
    realized_1h,
    goals_2h_so_far: goals_2h_so_far ?? 0,
    elapsed_2h_minutes: null as number | null,
  };
}

/**
 * Client-side 2H-heavy ranking for a batch.
 * Optionally loads cached API profiles (KV only — never calls AF inline).
 */
export function useTwoHHeavyRanking(
  batch: PredictionBatch | null,
  allBatches: PredictionBatch[],
  opts?: { refreshToken?: number }
): {
  byId: Record<string, TwoHHeavyResult>;
  ranked: TwoHHeavyResult[];
  loading: boolean;
} {
  const [apiByKey, setApiByKey] = useState<Record<string, CachedTeamHalfProfile>>({});
  const [histByKey, setHistByKey] = useState<Record<string, CachedTeamHalfProfile>>({});
  const [loading, setLoading] = useState(false);
  const refreshToken = opts?.refreshToken ?? 0;

  const requestKey = useMemo(() => {
    if (!batch) return "";
    return batch.matches
      .map((m) => {
        const league = matchLeague(m, batch.league);
        return `${m.homeTeam}|home|${league};${m.awayTeam}|away|${league}`;
      })
      .join(";;");
  }, [batch]);

  useEffect(() => {
    if (!batch || !requestKey) {
      setApiByKey({});
      setHistByKey({});
      return;
    }

    let cancelled = false;
    setLoading(true);

    const qs = new URLSearchParams();
    for (const match of batch.matches) {
      const league = matchLeague(match, batch.league);
      qs.append("q", `${match.homeTeam}|home|${league}`);
      qs.append("q", `${match.awayTeam}|away|${league}`);
    }

    void fetch(`/api/two-h-heavy/profiles?${qs.toString()}&fillGaps=1`)
      .then(async (res) => {
        const data = (await res.json()) as {
          profiles?: Record<string, CachedTeamHalfProfile>;
          histProfiles?: Record<string, CachedTeamHalfProfile>;
        };
        if (cancelled) return;
        setApiByKey(data.profiles ?? {});
        setHistByKey(data.histProfiles ?? {});
      })
      .catch(() => {
        if (!cancelled) {
          setApiByKey({});
          setHistByKey({});
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [batch, requestKey, refreshToken]);

  const ranked = useMemo(() => {
    if (!batch) return [];
    const liveByMatchId: Record<string, NonNullable<ReturnType<typeof liveContextFromMatch>>> =
      {};
    for (const m of batch.matches) {
      const live = liveContextFromMatch(m);
      if (live) liveByMatchId[m.id] = live;
    }
    return predictBatchTwoHHeavy(batch, allBatches, {
      histByKey,
      apiByKey,
      liveByMatchId,
    });
  }, [batch, allBatches, apiByKey, histByKey]);

  const byId = useMemo(() => {
    const out: Record<string, TwoHHeavyResult> = {};
    for (const r of ranked) out[r.matchId] = r;
    return out;
  }, [ranked]);

  return { byId, ranked, loading };
}

export { profileCacheKey };
