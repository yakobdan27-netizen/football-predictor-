"use client";

import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import { cloneMatchTeamStats } from "@/lib/prediction-log/match-learning";
import { LOG_MARKETS, LOG_MARKET_MAP, marketHasLineOptions } from "@/lib/prediction-log/markets-config";
import { scoreMatch } from "@/lib/prediction-log/scoring";
import { timingGoalsSum } from "@/lib/prediction-log/match-settlement";
import type { GoalTimingCurve, LogMarketKey, LogMatch, MarketActual, TeamSideStats } from "@/lib/prediction-log/types";

interface BatchResultAdvancedProps {
  match: LogMatch;
  onChange: (match: LogMatch) => void;
}

function setTeamStat(
  match: LogMatch,
  side: "home" | "away",
  field: keyof TeamSideStats,
  value: number | ""
): LogMatch {
  const teamStats = cloneMatchTeamStats(match);
  if (value === "" || !Number.isFinite(value)) {
    delete teamStats[side][field];
  } else {
    teamStats[side][field] = value;
  }
  return applyTeamStatsSync({ ...match, teamStats });
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
  return scoreMatch({ ...match, actualResults });
}

const TIMING_BUCKETS: Array<{ key: keyof GoalTimingCurve; label: string }> = [
  { key: "g0_15", label: "0–15" },
  { key: "g16_30", label: "16–30" },
  { key: "g31_45", label: "31–45" },
  { key: "g46_60", label: "46–60" },
  { key: "g61_75", label: "61–75" },
  { key: "g76_90plus", label: "76–90+" },
];

function MiniInput({
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
    <label style={{ display: "flex", flexDirection: "column", gap: "0.15rem", fontSize: "11px" }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        style={{ height: 26, fontSize: 12 }}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? "" : parseFloat(v));
        }}
      />
    </label>
  );
}

export function BatchResultAdvanced({ match, onChange }: BatchResultAdvancedProps) {
  const numericMarkets = LOG_MARKETS.filter(
    (m) => marketHasLineOptions(m) && match.predictions[m.key]
  );

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted)" }}>
        Goal timing summary
      </div>
      <div style={{ fontSize: "12px", color: "var(--muted)" }}>
        HT, corners, and timing buckets are edited in the main row. Summary:
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
          gap: "0.35rem",
          fontSize: "12px",
        }}
      >
        {TIMING_BUCKETS.map((b) => (
          <div key={b.key}>
            <span style={{ color: "var(--muted)" }}>{b.label}</span>
            <div>{match.teamStats?.goalTiming?.timingBuckets?.[b.key] ?? "—"}</div>
          </div>
        ))}
        <div>
          <span style={{ color: "var(--muted)" }}>Σ</span>
          <div>{timingGoalsSum(match.teamStats?.goalTiming) ?? "—"}</div>
        </div>
      </div>

      {numericMarkets.length > 0 ? (
        <>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted)" }}>
            Numeric market totals
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: "0.5rem",
            }}
          >
            {numericMarkets.map((def) => {
              const actual = match.actualResults[def.key]?.actual;
              return (
                <MiniInput
                  key={def.key}
                  label={LOG_MARKET_MAP[def.key].label}
                  value={typeof actual === "number" ? actual : undefined}
                  onChange={(v) => onChange(setActual(match, def.key, v === "" ? "" : v))}
                />
              );
            })}
          </div>
        </>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
          gap: "0.5rem",
        }}
      >
        <MiniInput
          label="Home shots"
          value={match.teamStats?.home?.totalShots}
          onChange={(v) => onChange(setTeamStat(match, "home", "totalShots", v))}
        />
        <MiniInput
          label="Away shots"
          value={match.teamStats?.away?.totalShots}
          onChange={(v) => onChange(setTeamStat(match, "away", "totalShots", v))}
        />
        <MiniInput
          label="Home SOT"
          value={match.teamStats?.home?.shotsOnTarget}
          onChange={(v) => onChange(setTeamStat(match, "home", "shotsOnTarget", v))}
        />
        <MiniInput
          label="Away SOT"
          value={match.teamStats?.away?.shotsOnTarget}
          onChange={(v) => onChange(setTeamStat(match, "away", "shotsOnTarget", v))}
        />
      </div>
    </div>
  );
}
