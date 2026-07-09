"use client";

import { useEffect, useMemo, useState } from "react";
import { computeDixonColes, pickProbFromMatrix } from "@/lib/prediction-log/statistics-engine";
import { findClubInIndex } from "@/lib/prediction-log/club-index";
import { computeLeagueBaselines } from "@/lib/prediction-log/league-baselines";
import { pickOptionsForMarket } from "@/lib/prediction-log/markets-config";
import { resolveMarketMode, singleMarketKey } from "@/lib/prediction-log/match-entry-helpers";
import { comboGridProbabilityPercent, enabledComboMarkets } from "@/lib/prediction-log/combo-markets-config";
import { loadClubRecordsForBatch } from "@/lib/prediction-log/club-record-insights";
import {
  ensureStorageInit,
  loadBatches,
  refreshClubIndex,
  fetchClubRecord,
} from "@/lib/prediction-log/storage";
import type { CombinedOddsSettings, LogMatch, PredictionBatch } from "@/lib/prediction-log/types";

export function useSystemPickLabel(
  match: LogMatch,
  league: string,
  date: string,
  comboSettings: CombinedOddsSettings
): { label: string; loading: boolean } {
  const [label, setLabel] = useState("—");
  const [loading, setLoading] = useState(false);

  const depsKey = useMemo(
    () =>
      JSON.stringify({
        home: match.homeTeam,
        away: match.awayTeam,
        mode: match.marketMode,
        comboId: match.comboPick?.comboId,
        predictions: match.predictions,
      }),
    [match]
  );

  useEffect(() => {
    if (!match.homeTeam || !match.awayTeam) {
      setLabel("—");
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          await ensureStorageInit();
          const batches = loadBatches();
          const clubIndex = await refreshClubIndex();
          const stub: PredictionBatch = {
            id: "sys-pick-stub",
            date,
            league,
            batchName: "entry",
            createdAt: new Date().toISOString(),
            batchKind: "manual",
            matches: [match],
          };
          const clubRecords = await loadClubRecordsForBatch(stub, clubIndex, fetchClubRecord);
          const homeEntry = clubIndex ? findClubInIndex(clubIndex, match.homeTeam, league) : null;
          const awayEntry = clubIndex ? findClubInIndex(clubIndex, match.awayTeam, league) : null;
          const homeRecord = homeEntry ? clubRecords[homeEntry.clubId] : null;
          const awayRecord = awayEntry ? clubRecords[awayEntry.clubId] : null;
          const leagueBaselines = computeLeagueBaselines(batches);
          const mode = resolveMarketMode(match);

          if (mode === "combined") {
            const dc = computeDixonColes(
              homeRecord,
              awayRecord,
              league,
              "1x2",
              "home",
              undefined,
              leagueBaselines,
              null
            );
            let bestId = "";
            let bestP = -1;
            for (const combo of enabledComboMarkets(comboSettings.markets)) {
              const p = comboGridProbabilityPercent(combo.id, {
                grid: dc.scoreGrid,
                lambdaHome: dc.lambdaHome,
                lambdaAway: dc.lambdaAway,
              });
              if (p != null && p > bestP) {
                bestP = p;
                bestId = combo.id;
              }
            }
            const best = enabledComboMarkets(comboSettings.markets).find((c) => c.id === bestId);
            if (!cancelled) setLabel(best?.label ?? "—");
            return;
          }

          const marketKey = singleMarketKey(match);
          if (!marketKey) {
            if (!cancelled) setLabel("—");
            return;
          }
          const pred = match.predictions[marketKey];
          const line = pred?.line;
          const dc = computeDixonColes(
            homeRecord,
            awayRecord,
            league,
            marketKey,
            pred?.prediction ?? "home",
            line,
            leagueBaselines,
            null
          );
          const options = pickOptionsForMarket(marketKey, match.homeTeam, match.awayTeam, line);
          let bestLabel = "—";
          let bestProb = -1;
          for (const opt of options) {
            const p = pickProbFromMatrix(dc.marketProbs, marketKey, opt.value, line);
            if (p > bestProb) {
              bestProb = p;
              bestLabel = opt.label;
            }
          }
          if (!cancelled) setLabel(bestLabel);
        } catch {
          if (!cancelled) setLabel("—");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [depsKey, league, date, match, comboSettings]);

  return { label, loading };
}
