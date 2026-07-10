"use client";

import { useEffect, useState } from "react";
import { computeEntryLegProbability } from "@/lib/prediction-log/combo-entry-probability";
import { batchRiskBand } from "@/lib/prediction-log/batch-risk-config";
import { loadClubRecordsForBatch } from "@/lib/prediction-log/club-record-insights";
import { resolveMarketMode } from "@/lib/prediction-log/match-entry-helpers";
import { scoreComboLeg } from "@/lib/prediction-log/combo-scoring";
import {
  ensureStorageInit,
  loadBatches,
  refreshClubIndex,
  fetchClubRecord,
} from "@/lib/prediction-log/storage";
import { isValidOdds } from "@/lib/prediction-log/odds-bands";
import { marketsEnteredCount } from "@/lib/prediction-log/scoring";
import type { CombinedOddsSettings, LogMatch, PredictionBatch } from "@/lib/prediction-log/types";

interface BatchSummaryStripProps {
  mode: "entry" | "result";
  matches?: LogMatch[];
  batch?: PredictionBatch;
  league?: string;
  date?: string;
  batchName?: string;
  comboSettings?: CombinedOddsSettings;
}

function primaryLegResult(match: LogMatch): string | null {
  if (match.primaryGrade?.result != null) return match.primaryGrade.result;
  const mode = resolveMarketMode(match);
  if (mode === "combined" && match.comboPick?.comboId) {
    return scoreComboLeg(match.comboPick.comboId, match.actualResults, match.teamStats);
  }
  const keys = Object.keys(match.predictions);
  if (keys.length !== 1) return null;
  return match.scored[keys[0] as keyof typeof match.scored] ?? null;
}

function matchLabel(m: LogMatch): string {
  if (m.homeTeam && m.awayTeam) return `${m.homeTeam} vs ${m.awayTeam}`;
  return m.homeTeam || m.awayTeam || "match";
}

export function BatchSummaryStrip({
  mode,
  matches: entryMatches,
  batch,
  league = "",
  date = "",
  batchName = "",
  comboSettings,
}: BatchSummaryStripProps) {
  const matches = mode === "result" ? (batch?.matches ?? []) : (entryMatches ?? []);
  const [avgProb, setAvgProb] = useState<number | null>(null);
  const [combinedOdds, setCombinedOdds] = useState<number | null>(null);

  useEffect(() => {
    if (mode !== "entry" || !comboSettings) {
      setAvgProb(null);
      setCombinedOdds(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      await ensureStorageInit();
      const batches = loadBatches();
      const clubIndex = await refreshClubIndex();
      const stub: PredictionBatch = {
        id: "strip-stub",
        date,
        league,
        batchName: batchName || "batch",
        createdAt: new Date().toISOString(),
        batchKind: "manual",
        matches,
      };
      const clubRecords = await loadClubRecordsForBatch(stub, clubIndex, fetchClubRecord);

      const probs: number[] = [];
      const oddsList: number[] = [];

      for (const m of matches) {
        if (!m.homeTeam || !m.awayTeam) continue;
        const prob = computeEntryLegProbability(m, league, clubRecords, clubIndex, batches);
        if (prob.pGrid != null) probs.push(prob.pGrid);

        const mMode = resolveMarketMode(m);
        if (mMode === "combined") {
          if (m.comboPick?.odds && isValidOdds(m.comboPick.odds)) {
            oddsList.push(m.comboPick.odds);
          }
        } else {
          const keys = Object.keys(m.predictions);
          if (keys.length === 1) {
            const o = m.predictions[keys[0] as keyof typeof m.predictions]?.odds;
            if (o != null && isValidOdds(o)) oddsList.push(o);
          }
        }
      }

      if (cancelled) return;
      setAvgProb(
        probs.length > 0
          ? Math.round(probs.reduce((a, b) => a + b, 0) / probs.length)
          : null
      );
      setCombinedOdds(
        oddsList.length >= 2
          ? Math.round(oddsList.reduce((p, o) => p * o, 1) * 100) / 100
          : oddsList.length === 1
            ? oddsList[0]!
            : null
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, matches, league, date, batchName, comboSettings]);

  if (matches.length === 0) return null;

  if (mode === "entry") {
    const risk =
      avgProb != null ? batchRiskBand(Math.max(0, 100 - avgProb)) : null;

    return (
      <div className="batch-summary-strip">
        {batchName ? (
          <>
            <strong>{batchName}</strong>
            {" · "}
          </>
        ) : null}
        {matches.length} matches
        {combinedOdds != null ? ` · Combined odds ×${combinedOdds}` : ""}
        {risk ? ` · Batch risk: ${risk}` : ""}
        {avgProb != null ? ` · Avg prob ${avgProb}%` : ""}
      </div>
    );
  }

  let won = 0;
  let lost = 0;
  let voided = 0;
  let pending = 0;
  let firstFailed: LogMatch | null = null;

  for (const m of matches) {
    const r = primaryLegResult(m);
    if (r === "correct") won++;
    else if (r === "wrong") {
      lost++;
      if (!firstFailed) firstFailed = m;
    } else if (r === "void" || r === "push") voided++;
    else pending++;
  }

  const countable = won + lost;
  const winRate = countable > 0 ? Math.round((won / countable) * 100) : null;

  let slipLine = "";
  if (pending === 0 && matches.length > 0) {
    if (lost === 0 && won > 0) {
      slipLine = "Batch slip: WON ✓";
    } else if (lost > 0 && firstFailed) {
      slipLine = `Batch slip: LOST (${lost} leg${lost === 1 ? "" : "s"} failed: ${matchLabel(firstFailed)})`;
    } else if (won === 0 && lost === 0 && voided > 0) {
      slipLine = "Batch slip: VOID (no countable legs)";
    }
  }

  const entered = batch ? marketsEnteredCount(batch) : { total: 0, scored: 0 };
  const batchOutcome =
    pending === 0 && countable > 0
      ? lost === 0
        ? "WON"
        : "LOST"
      : entered.scored === entered.total && entered.total > 0
        ? "SETTLED"
        : "PENDING";

  return (
    <div className="batch-summary-strip">
      <div>
        Result: <strong>{won} of {countable || matches.length} markets</strong>
        {winRate != null ? ` (${winRate}%)` : ""}
        {lost > 0 ? ` · ${lost} lost` : ""}
        {voided > 0 ? ` · ${voided} void/push` : ""}
        {" · "}
        Batch outcome: <strong>{batchOutcome}</strong>
        {batchOutcome === "SETTLED" || batchOutcome === "WON" || batchOutcome === "LOST"
          ? " · logged to learning loop on save"
          : ""}
      </div>
      {slipLine ? (
        <div className="batch-slip-line">
          <strong>{slipLine}</strong>
        </div>
      ) : null}
    </div>
  );
}
