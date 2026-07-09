"use client";

import { applyTeamStatsSync } from "@/lib/prediction-log/team-stats-sync";
import { LOG_MARKETS, LOG_MARKET_MAP } from "@/lib/prediction-log/markets-config";
import { scoreMatch } from "@/lib/prediction-log/scoring";
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
    (m) => m.kind === "numeric" && match.predictions[m.key]
  );

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--muted)" }}>
        Half-time &amp; timing
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
          gap: "0.5rem",
        }}
      >
        <MiniInput
          label={`${match.homeTeam} HT`}
          value={match.teamStats?.home?.firstHalfGoals}
          onChange={(v) => onChange(setTeamStat(match, "home", "firstHalfGoals", v))}
        />
        <MiniInput
          label={`${match.awayTeam} HT`}
          value={match.teamStats?.away?.firstHalfGoals}
          onChange={(v) => onChange(setTeamStat(match, "away", "firstHalfGoals", v))}
        />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", fontSize: "12px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={!!match.teamStats?.goalTiming?.goalInFirst10}
            onChange={(e) => onChange(setGoalTimingFlag(match, "goalInFirst10", e.target.checked))}
          />
          Goal 0–10 min
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input
            type="checkbox"
            checked={!!match.teamStats?.goalTiming?.goalInLast10}
            onChange={(e) => onChange(setGoalTimingFlag(match, "goalInLast10", e.target.checked))}
          />
          Goal 80–90+
        </label>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
          gap: "0.35rem",
        }}
      >
        {TIMING_BUCKETS.map((b) => (
          <MiniInput
            key={b.key}
            label={b.label}
            value={match.teamStats?.goalTiming?.timingBuckets?.[b.key]}
            onChange={(v) => {
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
              teamStats.goalTiming!.timingBuckets![b.key] =
                v === "" || !Number.isFinite(v) ? 0 : v;
              onChange(applyTeamStatsSync({ ...match, teamStats }));
            }}
          />
        ))}
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
        <MiniInput
          label="Home corners"
          value={match.teamStats?.home?.corners}
          onChange={(v) => onChange(setTeamStat(match, "home", "corners", v))}
        />
        <MiniInput
          label="Away corners"
          value={match.teamStats?.away?.corners}
          onChange={(v) => onChange(setTeamStat(match, "away", "corners", v))}
        />
      </div>
    </div>
  );
}
