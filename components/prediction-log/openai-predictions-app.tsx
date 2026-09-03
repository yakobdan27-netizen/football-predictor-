"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  OpenAiContextSummary,
  OpenAiWeekendPick,
} from "@/lib/prediction-log/openai-weekend-predictor";

type ApiResponse = {
  ok?: boolean;
  empty?: boolean;
  error?: string;
  runId?: number;
  weekendBatchId?: string | null;
  model?: string;
  promptVersion?: string;
  generatedAt?: string;
  matchCount?: number;
  summary?: OpenAiContextSummary;
  picks?: OpenAiWeekendPick[];
};

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

function resultStyle(result: string | null): React.CSSProperties {
  switch (result) {
    case "win":
      return { color: "#15803d", fontWeight: 600 };
    case "loss":
      return { color: "#b91c1c", fontWeight: 600 };
    case "push":
      return { color: "#a16207" };
    case "void":
      return { color: "var(--muted)" };
    default:
      return { color: "var(--muted)" };
  }
}

function picksToCsv(picks: OpenAiWeekendPick[]): string {
  const header = [
    "apiFixtureId",
    "homeTeam",
    "awayTeam",
    "league",
    "kickoffIso",
    "marketFamily",
    "marketLabel",
    "prediction",
    "confidencePct",
    "rationale",
    "systemMarket",
    "systemPrediction",
    "systemProbabilityPct",
    "result",
  ];
  const rows = picks.map((p) =>
    [
      p.apiFixtureId,
      p.homeTeam,
      p.awayTeam,
      p.league,
      p.kickoffIso,
      p.marketFamily,
      p.marketLabel,
      p.prediction,
      p.confidencePct,
      `"${p.rationale.replace(/"/g, '""')}"`,
      p.systemMarket ?? "",
      p.systemPrediction ?? "",
      p.systemProbabilityPct ?? "",
      p.result ?? "",
    ].join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

export function OpenAiPredictionsApp() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/openai-weekend-predictions");
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate(refresh = false) {
    setGenerating(true);
    setError(null);
    try {
      const url = refresh
        ? "/api/openai-weekend-predictions?refresh=1"
        : "/api/openai-weekend-predictions";
      const res = await fetch(url, { method: "POST" });
      const json = (await res.json()) as ApiResponse;
      if (res.status === 503) {
        throw new Error(
          json.error ??
            "OpenAI is not configured. Set OPENAI_API_KEY in environment."
        );
      }
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  function exportCsv() {
    if (!data?.picks?.length) return;
    const blob = new Blob([picksToCsv(data.picks)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openai-weekend-${data.weekendBatchId ?? "picks"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const summary = data?.summary;
  const picks = data?.picks ?? [];
  const graded = picks.filter((p) => p.result != null);
  const wins = graded.filter((p) => p.result === "win").length;
  const openAiAcc =
    graded.length > 0 ? Math.round((wins / graded.length) * 1000) / 10 : null;

  const historicalNote = useMemo(() => {
    if (!summary?.openAiHistoricalByFamily?.length) return null;
    const top = [...summary.openAiHistoricalByFamily]
      .filter((h) => h.wins + h.losses >= 3)
      .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
      .slice(0, 3);
    if (!top.length) return null;
    return top
      .map(
        (h) =>
          `${h.marketFamily} ${h.winRate ?? "?"}% (${h.wins}W/${h.losses}L)`
      )
      .join(" · ");
  }, [summary]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1rem",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          className="btn primary"
          disabled={generating}
          onClick={() => void generate(true)}
        >
          {generating ? "Generating…" : "Generate picks"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={loading}
          onClick={() => void load()}
        >
          Refresh
        </button>
        {picks.length > 0 && (
          <button type="button" className="btn" onClick={exportCsv}>
            Export CSV
          </button>
        )}
      </div>

      {error && (
        <p style={{ color: "#b91c1c", marginBottom: "1rem" }}>{error}</p>
      )}

      {summary && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "var(--surface2)",
            borderRadius: 8,
            marginBottom: "1rem",
            fontSize: "0.9rem",
            lineHeight: 1.6,
          }}
        >
          <strong>Context used</strong>
          {data?.weekendBatchId && (
            <span> · Batch {data.weekendBatchId}</span>
          )}
          {data?.model && <span> · Model {data.model}</span>}
          {data?.generatedAt && (
            <span>
              {" "}
              · Generated{" "}
              {new Date(data.generatedAt).toLocaleString(undefined, {
                timeZone: "UTC",
                timeZoneName: "short",
              })}
            </span>
          )}
          <div>
            Learner win rate:{" "}
            {summary.learnerWinRate != null
              ? `${summary.learnerWinRate}%`
              : "—"}{" "}
            ({summary.learnerScoredPicks} scored picks)
          </div>
          {openAiAcc != null && (
            <div>
              This run graded: {wins}/{graded.length} wins ({openAiAcc}%)
            </div>
          )}
          {historicalNote && (
            <div>OpenAI historical (top families): {historicalNote}</div>
          )}
          {summary.cautiousClubs.length > 0 && (
            <div>
              Cautious clubs: {summary.cautiousClubs.slice(0, 6).join(", ")}
            </div>
          )}
        </div>
      )}

      {loading && !data?.picks?.length && (
        <p className="page-sub">Loading latest run…</p>
      )}

      {!loading && data?.empty && !generating && (
        <p className="page-sub">
          No OpenAI run yet for the current weekend batch. Click Generate to
          create up to 30 picks.
        </p>
      )}

      {picks.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>Match</th>
                <th>League</th>
                <th>Kickoff (UTC)</th>
                <th>OpenAI pick</th>
                <th>Conf.</th>
                <th>Rationale</th>
                <th>System pick</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.homeTeam} vs {p.awayTeam}
                  </td>
                  <td>{p.league}</td>
                  <td>{formatKickoff(p.kickoffIso)}</td>
                  <td>
                    <strong>{p.marketLabel}</strong>
                    <br />
                    <span style={{ fontSize: "0.85rem" }}>{p.prediction}</span>
                  </td>
                  <td>{p.confidencePct}%</td>
                  <td style={{ maxWidth: 280, fontSize: "0.85rem" }}>
                    {p.rationale}
                  </td>
                  <td style={{ fontSize: "0.85rem" }}>
                    {p.systemMarket ?? "—"}
                    {p.systemPrediction && (
                      <>
                        <br />
                        {p.systemPrediction}
                        {p.systemProbabilityPct != null &&
                          ` (${p.systemProbabilityPct}%)`}
                      </>
                    )}
                  </td>
                  <td style={resultStyle(p.result)}>
                    {p.result ?? "pending"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
