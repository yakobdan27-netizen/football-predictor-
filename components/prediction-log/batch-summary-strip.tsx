"use client";

import { useEffect, useMemo, useState } from "react";
import { computeEntryLegProbability } from "@/lib/prediction-log/combo-entry-probability";
import { batchRiskBand } from "@/lib/prediction-log/batch-risk-config";
import { loadClubRecordsForBatch } from "@/lib/prediction-log/club-record-insights";
import { resolveMarketMode } from "@/lib/prediction-log/match-entry-helpers";
import { scoreComboLeg } from "@/lib/prediction-log/combo-scoring";
import {
  ensureStorageInit,
  loadBatches,
  loadRecommendationSettings,
  refreshClubIndex,
  fetchClubRecord,
} from "@/lib/prediction-log/storage";
import { isValidOdds } from "@/lib/prediction-log/odds-bands";
import { marketsEnteredCount } from "@/lib/prediction-log/scoring";
import {
  defaultBankrollStrategySettings,
  MIN_BETS_FOR_MEANINGFUL_METRICS,
} from "@/lib/prediction-log/recommendation-config";
import {
  aggregateBatchPlacementAlerts,
  batchPnL,
  evaluateStopLoss,
  formatMoney,
  maxRecommendedStake,
} from "@/lib/prediction-log/strategy-rules";
import { collectSettledBets } from "@/lib/prediction-log/evaluation-metrics";
import type {
  BankrollStrategySettings,
  CombinedOddsSettings,
  LogMatch,
  PredictionBatch,
} from "@/lib/prediction-log/types";
import { matchLeague } from "@/lib/prediction-log/match-league";

interface BatchSummaryStripProps {
  mode: "entry" | "result";
  matches?: LogMatch[];
  batch?: PredictionBatch;
  defaultLeague?: string;
  date?: string;
  batchName?: string;
  comboSettings?: CombinedOddsSettings;
  bankrollStrategy?: BankrollStrategySettings;
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
  defaultLeague = "",
  date = "",
  batchName = "",
  comboSettings,
  bankrollStrategy,
}: BatchSummaryStripProps) {
  const matches = mode === "result" ? (batch?.matches ?? []) : (entryMatches ?? []);
  const [avgProb, setAvgProb] = useState<number | null>(null);
  const [combinedOdds, setCombinedOdds] = useState<number | null>(null);

  const bs =
    bankrollStrategy ??
    loadRecommendationSettings().bankrollStrategy ??
    defaultBankrollStrategySettings();

  const stopLoss = useMemo(
    () => evaluateStopLoss(loadBatches(), bs),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when matches/settings identity changes
    [bs, matches.length, mode]
  );

  const placementAlerts = useMemo(() => {
    if (mode !== "entry") return { flags: [], messages: [] as string[] };
    return aggregateBatchPlacementAlerts(matches, bs, stopLoss);
  }, [mode, matches, bs, stopLoss]);

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
      const batchLeague = batch?.league ?? defaultLeague;
      const stub: PredictionBatch = {
        id: "strip-stub",
        date,
        league: batchLeague,
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
        const rowLeague = matchLeague(m, batchLeague);
        const modeM = resolveMarketMode(m);
        if (modeM === "combined") {
          if (m.comboPick?.odds && isValidOdds(m.comboPick.odds)) {
            oddsList.push(m.comboPick.odds);
          }
          const prob = computeEntryLegProbability(
            m,
            rowLeague,
            clubRecords,
            clubIndex,
            batches
          );
          if (prob.pGrid != null) probs.push(prob.pGrid);
        } else {
          const keys = Object.keys(m.predictions);
          if (keys.length === 1) {
            const pred = m.predictions[keys[0] as keyof typeof m.predictions];
            if (pred?.odds && isValidOdds(pred.odds)) oddsList.push(pred.odds);
            if (pred?.confidence != null) probs.push(pred.confidence);
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
  }, [mode, matches, defaultLeague, batch?.league, date, batchName, comboSettings]);

  if (matches.length === 0) return null;

  if (mode === "entry") {
    const risk =
      avgProb != null ? batchRiskBand(Math.max(0, 100 - avgProb)) : null;
    const maxStake = maxRecommendedStake(bs);
    const settledN = collectSettledBets(loadBatches()).length;

    return (
      <div className="batch-summary-strip">
        <div>
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
          {bs.bankroll != null ? ` · Bankroll ${bs.bankroll}` : ""}
          {maxStake != null ? ` · Max stake ${maxStake.toFixed(2)}` : ""}
        </div>
        {settledN < MIN_BETS_FOR_MEANINGFUL_METRICS ? (
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            Expected long-term note: metrics noisy until {MIN_BETS_FOR_MEANINGFUL_METRICS}+ bets
            (n={settledN}).
          </div>
        ) : null}
        {placementAlerts.messages.length > 0 ? (
          <div className="batch-strategy-alerts">
            {placementAlerts.messages.slice(0, 4).map((msg) => (
              <div key={msg}>⚠ {msg}</div>
            ))}
          </div>
        ) : stopLoss.stopLossActive ? (
          <div className="batch-strategy-alerts">
            ⚠ Stop-loss: {stopLoss.reason}. Suggested: pause.
          </div>
        ) : null}
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
  const pnl = batchPnL(matches);
  const settledN = collectSettledBets(loadBatches()).length;

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
        {pnl.totalPnL != null
          ? ` · P&L ${formatMoney(pnl.totalPnL)}${
              pnl.roiPct != null ? ` · ROI ${pnl.roiPct}%` : ""
            }`
          : ""}
        {batchOutcome === "SETTLED" || batchOutcome === "WON" || batchOutcome === "LOST"
          ? " · logged to learning loop on save"
          : ""}
      </div>
      {settledN < MIN_BETS_FOR_MEANINGFUL_METRICS ? (
        <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
          Expected long-term note: metrics noisy until {MIN_BETS_FOR_MEANINGFUL_METRICS}+ bets
          (n={settledN}).
        </div>
      ) : null}
      {slipLine ? (
        <div className="batch-slip-line">
          {slipLine}
        </div>
      ) : null}
    </div>
  );
}
