"use client";

import { useMemo, useState } from "react";
import {
  listTeamCharacteristics,
  saveManualTeamField,
} from "@/lib/prediction-log/team-characteristics";
import {
  loadTeamCharacteristics,
  saveTeamCharacteristics,
} from "@/lib/prediction-log/storage";
import type { TeamCharacteristics } from "@/lib/prediction-log/types";

function MetricRow({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: string | number;
  suffix?: string;
}) {
  return (
    <div style={{ fontSize: "0.8rem", marginBottom: "0.25rem" }}>
      <span style={{ color: "var(--muted)" }}>{label}: </span>
      <strong>
        {value}
        {suffix}
      </strong>
    </div>
  );
}

function EditableNumber({
  label,
  value,
  min,
  max,
  step = 0.1,
  onSave,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onSave: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <label className="label" style={{ fontSize: "0.75rem" }}>
        {label}
      </label>
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <input
          className="input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: "0.75rem" }}
          onClick={() => {
            const n = parseFloat(draft);
            if (Number.isFinite(n)) onSave(n);
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function TeamCard({
  team,
  onUpdate,
}: {
  team: TeamCharacteristics;
  onUpdate: (updated: TeamCharacteristics) => void;
}) {
  const [open, setOpen] = useState(false);

  function saveField(path: string, value: number | string) {
    let store = loadTeamCharacteristics();
    store = saveManualTeamField(store, team.clubId, path, value);
    saveTeamCharacteristics(store);
    const refreshed = store.teams[team.clubId];
    if (refreshed) onUpdate(refreshed);
  }

  return (
    <div className="card" style={{ marginBottom: "0.75rem" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          color: "inherit",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <strong>{team.clubName}</strong>
        <span style={{ fontSize: "0.8rem", color: "var(--muted)", marginLeft: "0.5rem" }}>
          {team.league} · {team.matchSamples} samples · form {team.additional.recentForm}/10
        </span>
      </button>

      {!open && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
          {team.attacking.attackingStyle} attack · {team.defending.defensiveStyle} defence ·{" "}
          {team.goals.goalsScoredAvg} GF / {team.goals.goalsConcededAvg} GA per game
        </div>
      )}

      {open && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
            Derived from your saved results. Manual saves are preserved on recompute.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "1rem",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.35rem" }}>
                Attacking
              </div>
              <MetricRow label="Style" value={team.attacking.attackingStyle} />
              <MetricRow label="Shot volume" value={team.attacking.shotVolume} />
              <MetricRow label="Shot accuracy" value={team.attacking.shotAccuracy} suffix="%" />
              <EditableNumber
                label="Set piece attack (0–10)"
                value={team.attacking.setPieceAttack}
                min={0}
                max={10}
                onSave={(v) => saveField("attacking.setPieceAttack", v)}
              />
            </div>

            <div>
              <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.35rem" }}>
                Defending
              </div>
              <MetricRow label="Style" value={team.defending.defensiveStyle} />
              <MetricRow label="Clean sheets" value={team.defending.cleanSheetRate} suffix="%" />
              <EditableNumber
                label="Pressure intensity (0–10)"
                value={team.defending.pressureIntensity}
                min={0}
                max={10}
                onSave={(v) => saveField("defending.pressureIntensity", v)}
              />
            </div>

            <div>
              <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.35rem" }}>
                Goals
              </div>
              <MetricRow label="Scored / game" value={team.goals.goalsScoredAvg} />
              <MetricRow label="Conceded / game" value={team.goals.goalsConcededAvg} />
              <EditableNumber
                label="xG / game"
                value={team.goals.xGPerGame}
                min={0}
                max={5}
                onSave={(v) => saveField("goals.xGPerGame", v)}
              />
            </div>

            <div>
              <div style={{ fontWeight: 600, fontSize: "0.8rem", marginBottom: "0.35rem" }}>
                Additional
              </div>
              <MetricRow label="Home rating" value={team.additional.homePerformance} suffix="/10" />
              <MetricRow label="Away rating" value={team.additional.awayPerformance} suffix="/10" />
              <EditableNumber
                label="Recent form (0–10)"
                value={team.additional.recentForm}
                min={0}
                max={10}
                step={1}
                onSave={(v) => saveField("additional.recentForm", v)}
              />
            </div>
          </div>

          <details style={{ marginTop: "0.75rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>
              All characteristics (read-only summary)
            </summary>
            <pre
              style={{
                fontSize: "0.7rem",
                overflow: "auto",
                marginTop: "0.5rem",
                padding: "0.5rem",
                background: "var(--surface2)",
                borderRadius: "6px",
              }}
            >
              {JSON.stringify(team, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

export function TeamCharacteristicsTab() {
  const [store, setStore] = useState(() => loadTeamCharacteristics());
  const teams = useMemo(() => listTeamCharacteristics(store), [store]);
  const [filter, setFilter] = useState("");

  const filtered = teams.filter(
    (t) =>
      !filter.trim() ||
      t.clubName.toLowerCase().includes(filter.toLowerCase()) ||
      t.league.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div>
      <p className="page-sub" style={{ marginBottom: "1rem" }}>
        Team characteristics are updated from your saved match results. Edit fields manually to
        refine what the AI Learner uses — all data stays in local storage.
      </p>

      <input
        className="input"
        placeholder="Filter by club or league…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ marginBottom: "1rem", maxWidth: "320px" }}
      />

      {filtered.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>
          No team characteristics yet. Save batch results with goal, shot, or offside actuals to
          build profiles.
        </p>
      ) : (
        filtered.map((team) => (
          <TeamCard
            key={team.clubId}
            team={team}
            onUpdate={(updated) =>
              setStore((prev) => ({
                ...prev,
                teams: { ...prev.teams, [team.clubId]: updated },
              }))
            }
          />
        ))
      )}
    </div>
  );
}
