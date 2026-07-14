"use client";

import { useEffect, useState } from "react";
import { computeEntryLegProbability, formatValueEdge } from "@/lib/prediction-log/combo-entry-probability";
import { batchRiskBand } from "@/lib/prediction-log/batch-risk-config";
import { loadClubRecordsForBatch } from "@/lib/prediction-log/club-record-insights";
import {
  matchLegLabel,
  resolveMarketMode,
} from "@/lib/prediction-log/match-entry-helpers";
import {
  ensureStorageInit,
  loadBatches,
  refreshClubIndex,
  fetchClubRecord,
} from "@/lib/prediction-log/storage";
import { isValidOdds } from "@/lib/prediction-log/odds-bands";
import { matchLeague } from "@/lib/prediction-log/match-league";
import type { CombinedOddsSettings, LogMatch, PredictionBatch } from "@/lib/prediction-log/types";

interface MatchSummaryRow {
  matchId: string;
  label: string;
  mode: string;
  marketLabel: string;
  odds: number | null;
  pGrid: number | null;
  valueEdge: number | null;
}

interface BatchEntrySummaryProps {
  batchName: string;
  defaultLeague: string;
  date: string;
  matches: LogMatch[];
  comboSettings: CombinedOddsSettings;
}

export function BatchEntrySummary({
  batchName,
  defaultLeague,
  date,
  matches,
  comboSettings,
}: BatchEntrySummaryProps) {
  const [rows, setRows] = useState<MatchSummaryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureStorageInit();
      const batches = loadBatches();
      const clubIndex = await refreshClubIndex();
      const stub: PredictionBatch = {
        id: "summary-stub",
        date,
        league: defaultLeague,
        batchName: batchName || "batch",
        createdAt: new Date().toISOString(),
        batchKind: "manual",
        matches,
      };
      const clubRecords = await loadClubRecordsForBatch(stub, clubIndex, fetchClubRecord);
      const next: MatchSummaryRow[] = [];
      for (const m of matches) {
        if (!m.homeTeam || !m.awayTeam) continue;
        const rowLeague = matchLeague(m, defaultLeague);
        const mode = resolveMarketMode(m);
        const prob = computeEntryLegProbability(m, rowLeague, clubRecords, clubIndex, batches);
        const odds =
          mode === "combined"
            ? m.comboPick?.odds && m.comboPick.odds > 0
              ? m.comboPick.odds
              : null
            : (() => {
                const keys = Object.keys(m.predictions);
                if (keys.length !== 1) return null;
                return m.predictions[keys[0] as keyof typeof m.predictions]?.odds ?? null;
              })();
        next.push({
          matchId: m.id,
          label: `${m.homeTeam} vs ${m.awayTeam}`,
          mode: mode === "combined" ? "Combined" : "Single",
          marketLabel: matchLegLabel(m),
          odds: odds != null && isValidOdds(odds) ? odds : null,
          pGrid: prob.pGrid,
          valueEdge: prob.valueEdge,
        });
      }
      if (!cancelled) setRows(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [batchName, defaultLeague, date, matches, comboSettings]);

  if (rows.length === 0) return null;

  const combinedRows = rows.filter((r) => r.mode === "Combined" && r.odds != null);
  const accaOdds =
    combinedRows.length >= 2
      ? Math.round(combinedRows.reduce((p, r) => p * (r.odds ?? 1), 1) * 100) / 100
      : null;
  const accaProb =
    combinedRows.length >= 2 && combinedRows.every((r) => r.pGrid != null)
      ? Math.round(
          combinedRows.reduce((p, r) => p * ((r.pGrid ?? 0) / 100), 1) * 1000
        ) / 10
      : null;
  const accaRisk =
    accaProb != null ? batchRiskBand(Math.max(0, 100 - accaProb)) : null;

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <strong>Batch summary</strong>
      {batchName ? (
        <div style={{ fontSize: "0.875rem", color: "var(--muted)", marginTop: "0.25rem" }}>
          {batchName} · {defaultLeague}
        </div>
      ) : null}
      <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.65rem" }}>
        {rows.map((row) => {
          const value = formatValueEdge(row.valueEdge, comboSettings.highlightPositiveValue);
          return (
            <div
              key={row.matchId}
              style={{
                padding: "0.5rem 0",
                borderBottom: "1px solid var(--border)",
                fontSize: "0.8125rem",
              }}
            >
              <div style={{ fontWeight: 600 }}>{row.label}</div>
              <div style={{ color: "var(--muted)" }}>
                {row.mode}: {row.marketLabel}
              </div>
              <div>
                Odds: {row.odds ?? "—"}
                {row.pGrid != null ? ` · System: ${row.pGrid}%` : ""}
                {row.valueEdge != null ? (
                  <>
                    {" "}
                    · Value: <span style={{ color: value.color }}>{value.text}</span>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {combinedRows.length >= 2 && accaOdds != null ? (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.75rem",
            borderRadius: "6px",
            background: "var(--surface2)",
            fontSize: "0.8125rem",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>Batch accumulator (combined legs)</div>
          <div>Combined odds: {accaOdds}</div>
          <div>System probability: {accaProb != null ? `${accaProb}%` : "—"} (independent product)</div>
          <div>Risk level: {accaRisk ?? "—"}</div>
        </div>
      ) : null}
    </div>
  );
}
