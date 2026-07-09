"use client";

import { useState } from "react";
import {
  actualOptionsForMarket,
  LOG_MARKETS,
  LOG_MARKET_MAP,
} from "@/lib/prediction-log/markets-config";
import { scoreMatch } from "@/lib/prediction-log/scoring";
import { getFinalScoreDisplay, getHalfTimeGoalsDisplay } from "@/lib/prediction-log/goal-result-sync";
import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import type { GoalTimingCurve, LogMarketKey, LogMatch, MarketActual, TeamSideStats } from "@/lib/prediction-log/types";
import { PickSegment } from "@/components/pick-segment";

interface MatchActualsFormProps {
  match: LogMatch;
  onChange: (match: LogMatch) => void;
}

function setActual(
  match: LogMatch,
  key: LogMarketKey,
  actual: string | number | ""
): LogMatch {
  const actualResults = { ...match.actualResults };
  if (actual === "" || actual == null) {
    delete actualResults[key];
  } else {
    actualResults[key] = { actual } as MarketActual;
  }
  const updated = { ...match, actualResults };
  return scoreMatch(updated);
}

function scoreBadge(result: string | null | undefined) {
  if (!result) return null;
  const colors: Record<string, string> = {
    correct: "var(--accent)",
    wrong: "var(--danger)",
    push: "var(--warn)",
  };
  return (
    <span
      style={{
        fontSize: "0.75rem",
        fontWeight: 700,
        color: colors[result] ?? "var(--muted)",
        textTransform: "uppercase",
      }}
    >
      {result}
    </span>
  );
}

function setTeamStat(
  match: LogMatch,
  side: "home" | "away",
  field: keyof TeamSideStats,
  value: number | ""
): LogMatch {
  const teamStats = {
    home: { ...match.teamStats?.home },
    away: { ...match.teamStats?.away },
    firstHalfResult: match.teamStats?.firstHalfResult,
    goalTiming: match.teamStats?.goalTiming,
    penaltyAwarded: match.teamStats?.penaltyAwarded,
  };
  if (value === "" || !Number.isFinite(value)) {
    delete teamStats[side][field];
  } else {
    teamStats[side][field] = value;
  }
  return applyTeamStatsSync({ ...match, teamStats });
}

function setFirstHalfResult(
  match: LogMatch,
  value: "home" | "draw" | "away" | ""
): LogMatch {
  const teamStats = {
    home: { ...match.teamStats?.home },
    away: { ...match.teamStats?.away },
    firstHalfResult: match.teamStats?.firstHalfResult,
    goalTiming: match.teamStats?.goalTiming,
    penaltyAwarded: match.teamStats?.penaltyAwarded,
  };
  if (value === "") {
    delete teamStats.firstHalfResult;
  } else {
    teamStats.firstHalfResult = value;
  }
  return applyTeamStatsSync({ ...match, teamStats });
}

function setGoalTimingFlag(
  match: LogMatch,
  field: "goalInFirst10" | "goalInLast10" | "secondHalfCards",
  checked: boolean
): LogMatch {
  const teamStats = {
    home: { ...match.teamStats?.home },
    away: { ...match.teamStats?.away },
    firstHalfResult: match.teamStats?.firstHalfResult,
    goalTiming: { ...match.teamStats?.goalTiming },
    penaltyAwarded: match.teamStats?.penaltyAwarded,
  };
  if (checked) teamStats.goalTiming![field] = true;
  else delete teamStats.goalTiming![field];
  return applyTeamStatsSync({ ...match, teamStats });
}

function setPenaltyAwarded(match: LogMatch, checked: boolean): LogMatch {
  const teamStats = {
    home: { ...match.teamStats?.home },
    away: { ...match.teamStats?.away },
    firstHalfResult: match.teamStats?.firstHalfResult,
    goalTiming: match.teamStats?.goalTiming,
    penaltyAwarded: checked || undefined,
  };
  if (!checked) delete teamStats.penaltyAwarded;
  return applyTeamStatsSync({ ...match, teamStats });
}

function setTimingBucket(
  match: LogMatch,
  bucket: keyof GoalTimingCurve,
  value: number | ""
): LogMatch {
  const teamStats = {
    home: { ...match.teamStats?.home },
    away: { ...match.teamStats?.away },
    firstHalfResult: match.teamStats?.firstHalfResult,
    goalTiming: {
      ...match.teamStats?.goalTiming,
      timingBuckets: {
        g0_15: 0,
        g16_30: 0,
        g31_45: 0,
        g46_60: 0,
        g61_75: 0,
        g76_90plus: 0,
        ...match.teamStats?.goalTiming?.timingBuckets,
      },
    },
    penaltyAwarded: match.teamStats?.penaltyAwarded,
  };
  if (value === "" || !Number.isFinite(value)) {
    teamStats.goalTiming!.timingBuckets![bucket] = 0;
  } else {
    teamStats.goalTiming!.timingBuckets![bucket] = value;
  }
  return applyTeamStatsSync({ ...match, teamStats });
}

const TIMING_BUCKETS: Array<{ key: keyof GoalTimingCurve; label: string }> = [
  { key: "g0_15", label: "0–15 min" },
  { key: "g16_30", label: "16–30 min" },
  { key: "g31_45", label: "31–45 min" },
  { key: "g46_60", label: "46–60 min" },
  { key: "g61_75", label: "61–75 min" },
  { key: "g76_90plus", label: "76–90+ min" },
];

function StatInput({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value?: number;
  onChange: (v: number | "") => void;
  max?: number;
}) {
  return (
    <div>
      <label className="label" style={{ fontSize: "0.75rem" }}>
        {label}
      </label>
      <input
        className="input"
        type="number"
        min={0}
        max={max}
        step={1}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? "" : parseFloat(v));
        }}
      />
    </div>
  );
}

export function MatchActualsForm({ match, onChange }: MatchActualsFormProps) {
  const scored = scoreMatch(match);
  const [statsOpen, setStatsOpen] = useState(false);
  const [timingDetailOpen, setTimingDetailOpen] = useState(false);
  const finalScore = getFinalScoreDisplay(match);
  const htScore = getHalfTimeGoalsDisplay(match);

  return (
    <div
      className="card"
      style={{ marginBottom: "1rem", borderColor: "var(--border)" }}
    >
      <strong>
        {match.homeTeam} vs {match.awayTeam}
      </strong>

      <div
        style={{
          marginTop: "0.75rem",
          padding: "0.75rem",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          background: "var(--surface-2, rgba(255,255,255,0.02))",
        }}
      >
        <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.5rem" }}>
          Final result
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "0.75rem",
          }}
        >
          <StatInput
            label={`${match.homeTeam} (home) goals`}
            value={finalScore.homeGoals}
            onChange={(v) => onChange(setTeamStat(match, "home", "goals", v))}
          />
          <StatInput
            label={`${match.awayTeam} (away) goals`}
            value={finalScore.awayGoals}
            onChange={(v) => onChange(setTeamStat(match, "away", "goals", v))}
          />
        </div>
        {finalScore.homeGoals != null && finalScore.awayGoals != null ? (
          <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", fontWeight: 600 }}>
            Score: {finalScore.homeGoals} – {finalScore.awayGoals}
          </div>
        ) : null}
        <div style={{ marginTop: "0.35rem", fontSize: "0.75rem", color: "var(--muted)" }}>
          Fills match result, BTTS, and team goals markets for your predictions.
        </div>
      </div>

      <details
        style={{
          marginTop: "0.75rem",
          padding: "0.75rem",
          border: "1px solid var(--border)",
          borderRadius: "6px",
        }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.875rem" }}>
          Half-time &amp; timing (optional)
        </summary>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "0.75rem",
            marginTop: "0.75rem",
          }}
        >
          <StatInput
            label={`${match.homeTeam} HT goals`}
            value={htScore.homeGoals}
            onChange={(v) => onChange(setTeamStat(match, "home", "firstHalfGoals", v))}
          />
          <StatInput
            label={`${match.awayTeam} HT goals`}
            value={htScore.awayGoals}
            onChange={(v) => onChange(setTeamStat(match, "away", "firstHalfGoals", v))}
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8125rem" }}>
            <input
              type="checkbox"
              checked={!!match.teamStats?.goalTiming?.goalInFirst10}
              onChange={(e) => onChange(setGoalTimingFlag(match, "goalInFirst10", e.target.checked))}
            />
            Goal in first 10 min
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8125rem" }}>
            <input
              type="checkbox"
              checked={!!match.teamStats?.goalTiming?.goalInLast10}
              onChange={(e) => onChange(setGoalTimingFlag(match, "goalInLast10", e.target.checked))}
            />
            Goal in last 10 min (80–90+)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8125rem" }}>
            <input
              type="checkbox"
              checked={!!match.teamStats?.penaltyAwarded}
              onChange={(e) => onChange(setPenaltyAwarded(match, e.target.checked))}
            />
            Penalty awarded
          </label>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}
          onClick={() => setTimingDetailOpen((v) => !v)}
        >
          {timingDetailOpen ? "Hide timing detail" : "Add timing detail"}
        </button>
        {timingDetailOpen ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "0.75rem",
              marginTop: "0.75rem",
            }}
          >
            {TIMING_BUCKETS.map(({ key, label }) => (
              <StatInput
                key={key}
                label={`Goals ${label}`}
                value={match.teamStats?.goalTiming?.timingBuckets?.[key]}
                onChange={(v) => onChange(setTimingBucket(match, key, v))}
              />
            ))}
          </div>
        ) : null}
        <div style={{ marginTop: "0.35rem", fontSize: "0.75rem", color: "var(--muted)" }}>
          HT goals sync half-time markets. Timing fields feed league character profiles.
        </div>
      </details>

      <div style={{ display: "grid", gap: "1rem", marginTop: "0.75rem" }}>
        {LOG_MARKETS.map((def) => {
          const pred = match.predictions[def.key];
          if (!pred) return null;
          const actualVal = match.actualResults[def.key]?.actual;
          const result = scored.scored[def.key];
          const home = match.homeTeam || "Home";
          const away = match.awayTeam || "Away";
          const catOptions = actualOptionsForMarket(def.key, home, away);

          return (
            <div
              key={def.key}
              style={{
                paddingBottom: "0.75rem",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.35rem",
                }}
              >
                <span style={{ fontSize: "0.875rem" }}>{def.label}</span>
                {scoreBadge(result)}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
                Your pick: {pred.prediction}
                {pred.line != null ? ` @ ${pred.line}` : ""} ({pred.confidence}%
                {pred.odds != null ? `, odds ${pred.odds}` : ""})
              </div>

              {def.kind === "numeric" ? (
                <input
                  className="input"
                  type="number"
                  step="any"
                  placeholder="Enter actual total"
                  value={actualVal ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange(
                      setActual(
                        match,
                        def.key,
                        v === "" ? "" : parseFloat(v)
                      )
                    );
                  }}
                />
              ) : catOptions ? (
                <PickSegment
                  options={catOptions}
                  value={typeof actualVal === "string" ? actualVal : ""}
                  onChange={(v) => onChange(setActual(match, def.key, v))}
                  ariaLabel={`Actual ${def.label}`}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <details
        open={statsOpen}
        onToggle={(e) => setStatsOpen((e.target as HTMLDetailsElement).open)}
        style={{ marginTop: "1rem" }}
      >
        <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.875rem" }}>
          Team stats (match events)
        </summary>
        <div style={{ marginTop: "0.75rem", marginBottom: "0.75rem" }}>
          <div className="stat-label" style={{ marginBottom: "0.35rem" }}>
            First half result
          </div>
          <PickSegment
            options={actualOptionsForMarket("ht_1x2", match.homeTeam, match.awayTeam) ?? []}
            value={match.teamStats?.firstHalfResult ?? ""}
            onChange={(v) => onChange(setFirstHalfResult(match, v as "home" | "draw" | "away" | ""))}
            ariaLabel="First half result"
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "1rem",
            marginTop: "0.75rem",
          }}
        >
          <div>
            <div className="stat-label" style={{ marginBottom: "0.5rem" }}>
              {match.homeTeam} (home)
            </div>
            <StatInput
              label="Yellow cards"
              value={match.teamStats?.home?.yellowCards}
              onChange={(v) => onChange(setTeamStat(match, "home", "yellowCards", v))}
            />
            <StatInput
              label="Red cards"
              value={match.teamStats?.home?.redCards}
              onChange={(v) => onChange(setTeamStat(match, "home", "redCards", v))}
            />
            <StatInput
              label="Fouls"
              value={match.teamStats?.home?.fouls}
              onChange={(v) => onChange(setTeamStat(match, "home", "fouls", v))}
            />
            <StatInput
              label="Possession %"
              value={match.teamStats?.home?.possession}
              max={100}
              onChange={(v) => onChange(setTeamStat(match, "home", "possession", v))}
            />
            <StatInput
              label="Total shots"
              value={match.teamStats?.home?.totalShots}
              onChange={(v) => onChange(setTeamStat(match, "home", "totalShots", v))}
            />
            <StatInput
              label="Shots on target"
              value={match.teamStats?.home?.shotsOnTarget}
              onChange={(v) => onChange(setTeamStat(match, "home", "shotsOnTarget", v))}
            />
            <StatInput
              label="Corners"
              value={match.teamStats?.home?.corners}
              onChange={(v) => onChange(setTeamStat(match, "home", "corners", v))}
            />
            <StatInput
              label="Throw-ins"
              value={match.teamStats?.home?.throwIns}
              onChange={(v) => onChange(setTeamStat(match, "home", "throwIns", v))}
            />
            <StatInput
              label="Offsides"
              value={match.teamStats?.home?.offsides}
              onChange={(v) => onChange(setTeamStat(match, "home", "offsides", v))}
            />
          </div>
          <div>
            <div className="stat-label" style={{ marginBottom: "0.5rem" }}>
              {match.awayTeam} (away)
            </div>
            <StatInput
              label="Yellow cards"
              value={match.teamStats?.away?.yellowCards}
              onChange={(v) => onChange(setTeamStat(match, "away", "yellowCards", v))}
            />
            <StatInput
              label="Red cards"
              value={match.teamStats?.away?.redCards}
              onChange={(v) => onChange(setTeamStat(match, "away", "redCards", v))}
            />
            <StatInput
              label="Fouls"
              value={match.teamStats?.away?.fouls}
              onChange={(v) => onChange(setTeamStat(match, "away", "fouls", v))}
            />
            <StatInput
              label="Possession %"
              value={match.teamStats?.away?.possession}
              max={100}
              onChange={(v) => onChange(setTeamStat(match, "away", "possession", v))}
            />
            <StatInput
              label="Total shots"
              value={match.teamStats?.away?.totalShots}
              onChange={(v) => onChange(setTeamStat(match, "away", "totalShots", v))}
            />
            <StatInput
              label="Shots on target"
              value={match.teamStats?.away?.shotsOnTarget}
              onChange={(v) => onChange(setTeamStat(match, "away", "shotsOnTarget", v))}
            />
            <StatInput
              label="Corners"
              value={match.teamStats?.away?.corners}
              onChange={(v) => onChange(setTeamStat(match, "away", "corners", v))}
            />
            <StatInput
              label="Throw-ins"
              value={match.teamStats?.away?.throwIns}
              onChange={(v) => onChange(setTeamStat(match, "away", "throwIns", v))}
            />
            <StatInput
              label="Offsides"
              value={match.teamStats?.away?.offsides}
              onChange={(v) => onChange(setTeamStat(match, "away", "offsides", v))}
            />
          </div>
        </div>
      </details>
    </div>
  );
}
