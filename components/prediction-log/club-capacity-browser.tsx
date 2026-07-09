"use client";

import { useEffect, useMemo, useState } from "react";
import { HISTORY_TYPE_KEYS } from "@/lib/prediction-log/club-record-types";
import type { ClubIndex, ClubRecord, HistoryTypeKey } from "@/lib/prediction-log/club-record-types";
import { fetchClubRecord } from "@/lib/prediction-log/storage";

const TYPE_LABELS: Record<HistoryTypeKey, string> = {
  winLose: "Win / Lose",
  shotsOnTarget: "Shots on target",
  totalShots: "Total shots",
  goalsScored: "Goals scored",
  goalsConceded: "Goals conceded",
  cleanSheet: "Clean sheet",
  yellowCards: "Yellow cards",
  redCards: "Red cards",
  corners: "Corners",
  offsides: "Offsides",
  fouls: "Fouls",
  possession: "Possession",
  bothTeamsScore: "Both teams score",
  overUnder: "Over / Under",
};

interface ClubCapacityBrowserProps {
  clubIndex: ClubIndex | null;
}

export function ClubCapacityBrowser({ clubIndex }: ClubCapacityBrowserProps) {
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [club, setClub] = useState<ClubRecord | null>(null);
  const [historyType, setHistoryType] = useState<HistoryTypeKey>("winLose");

  const entries = useMemo(() => {
    if (!clubIndex) return [];
    return clubIndex.clubs.filter(
      (c) =>
        !filter.trim() ||
        c.clubName.toLowerCase().includes(filter.toLowerCase()) ||
        c.league.toLowerCase().includes(filter.toLowerCase())
    );
  }, [clubIndex, filter]);

  useEffect(() => {
    const id = selectedId || entries[0]?.clubId;
    if (!id) {
      setClub(null);
      return;
    }
    void fetchClubRecord(id).then(setClub);
  }, [selectedId, entries]);

  if (!clubIndex || clubIndex.clubs.length === 0) {
    return (
      <p style={{ color: "var(--muted)" }}>
        No club records yet. Save a batch with predictions to create club histories.
      </p>
    );
  }

  const cap = club?.capacity;

  return (
    <div>
      <input
        className="input"
        placeholder="Filter clubs…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: "0.75rem", maxWidth: "320px" }}
      />

      <select
        className="select"
        value={selectedId || entries[0]?.clubId || ""}
        onChange={(e) => setSelectedId(e.target.value)}
        style={{ marginBottom: "1rem", maxWidth: "100%" }}
      >
        {entries.map((e) => (
          <option key={e.clubId} value={e.clubId}>
            {e.clubName} ({e.league})
          </option>
        ))}
      </select>

      {cap && (
        <div className="stat-grid" style={{ marginBottom: "1rem" }}>
          <div className="card">
            <div className="stat-value">{cap.winRate}%</div>
            <div className="stat-label">Win rate</div>
          </div>
          <div className="card">
            <div className="stat-value">{cap.recentForm}/10</div>
            <div className="stat-label">Recent form</div>
          </div>
          <div className="card">
            <div className="stat-value">{cap.sampleSize}</div>
            <div className="stat-label">Samples</div>
          </div>
          <div className="card">
            <div className="stat-value" style={{ fontSize: "0.9rem" }}>
              {cap.lowSample ? "Low data" : "OK"}
            </div>
            <div className="stat-label">Confidence</div>
          </div>
        </div>
      )}

      <select
        className="select"
        value={historyType}
        onChange={(e) => setHistoryType(e.target.value as HistoryTypeKey)}
        style={{ marginBottom: "0.75rem" }}
      >
        {HISTORY_TYPE_KEYS.map((k) => (
          <option key={k} value={k}>
            {TYPE_LABELS[k]}
          </option>
        ))}
      </select>

      {club && (
        <div className="card">
          <strong style={{ fontSize: "0.875rem" }}>
            {TYPE_LABELS[historyType]} history
            {cap?.predictionAccuracyByType[historyType] != null &&
              ` — ${cap.predictionAccuracyByType[historyType]}% accuracy`}
          </strong>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", fontSize: "0.8125rem" }}>
            {club.histories[historyType]
              .filter((e) => !e.superseded)
              .slice(-20)
              .reverse()
              .map((e) => (
                <li key={e.id} style={{ marginBottom: "0.35rem", color: "var(--muted)" }}>
                  {e.date} vs {e.opponentName} ({e.venue}) — pred {String(e.predicted)}
                  {e.actual != null ? `, actual ${String(e.actual)}` : ""} —{" "}
                  <span
                    style={{
                      color:
                        e.result === "hit"
                          ? "var(--accent)"
                          : e.result === "miss"
                            ? "var(--danger)"
                            : "var(--warn)",
                    }}
                  >
                    {e.result}
                  </span>
                </li>
              ))}
          </ul>
          {club.histories[historyType].filter((e) => !e.superseded).length === 0 && (
            <p style={{ margin: "0.5rem 0 0", color: "var(--muted)" }}>No entries yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
