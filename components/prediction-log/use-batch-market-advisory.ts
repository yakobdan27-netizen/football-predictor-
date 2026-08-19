"use client";

import { useEffect, useState } from "react";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { MatchDecisionRow } from "@/lib/prediction-log/decision-maker/types";
import type { MarketAdvisoryUiPayload } from "@/lib/market-advisory/types";
import type { ScoredDecisionMarket } from "@/lib/prediction-log/decision-maker/types";

export function useBatchMarketAdvisory(input: {
  rows: MatchDecisionRow[];
  cfeByMatchId: Map<string, CanonicalFixtureEstimate>;
  enabled: boolean;
}): {
  advisories: Map<string, MarketAdvisoryUiPayload>;
  loading: boolean;
} {
  const [advisories, setAdvisories] = useState<Map<string, MarketAdvisoryUiPayload>>(
    new Map()
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!input.enabled || input.rows.length === 0) {
      setAdvisories(new Map());
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const next = new Map<string, MarketAdvisoryUiPayload>();
      for (const row of input.rows) {
        const cfe = input.cfeByMatchId.get(row.match.id);
        if (!cfe) continue;
        const fixtureId = row.match.apiFixtureId ?? 0;
        if (fixtureId <= 0) continue;

        try {
          const res = await fetch("/api/market-advisory/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fixtureId,
              matchId: row.match.id,
              homeTeam: row.match.homeTeam,
              awayTeam: row.match.awayTeam,
              league: row.league,
              kickoffIso: row.match.matchDate,
              emsKind: "decision_maker",
              cfe,
              emsMarkets: row.markets as ScoredDecisionMarket[],
            }),
          });
          const json = await res.json();
          if (json.ok && json.advisory) {
            next.set(row.match.id, json.advisory as MarketAdvisoryUiPayload);
          }
        } catch {
          /* advisory is optional */
        }
        if (cancelled) return;
      }
      if (!cancelled) {
        setAdvisories(next);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [input.rows, input.cfeByMatchId, input.enabled]);

  return { advisories, loading };
}
