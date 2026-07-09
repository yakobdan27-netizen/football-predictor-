import type { QualityTier } from "./teams-quality-types";
import { lookupTeam } from "./teams-quality";
import type { TeamsQualityStore } from "./teams-quality-types";
import { STAT_ENGINE_CONFIG } from "./stat-engine-config";
import type { ClubRecord, ClubStatMetadata, HistoryEntry } from "./club-record-types";
import type { LeagueBaselinesStore } from "./league-baselines";
import { getLeagueBaseline } from "./league-baselines";

const { ROLLING_WINDOW_N, STRENGTH_CLAMP_MIN, STRENGTH_CLAMP_MAX, DEFAULT_LEAGUE_HOME_GOALS, DEFAULT_LEAGUE_AWAY_GOALS } =
  STAT_ENGINE_CONFIG;

function clampStrength(n: number): number {
  return Math.max(STRENGTH_CLAMP_MIN, Math.min(STRENGTH_CLAMP_MAX, n));
}

function resolved(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.filter((e) => !e.superseded && (e.result === "hit" || e.result === "miss"));
}

function rollingNumeric(entries: HistoryEntry[], venue?: "home" | "away"): number {
  let list = resolved(entries);
  if (venue) list = list.filter((e) => e.venue === venue);
  list.sort((a, b) => b.date.localeCompare(a.date));
  const recent = list.slice(0, ROLLING_WINDOW_N);
  const nums = recent
    .map((e) => {
      const v = e.actual;
      return typeof v === "number" ? v : parseFloat(String(v ?? ""));
    })
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function formPoints(record: ClubRecord): number {
  const wl = resolved(record.histories.winLose)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, ROLLING_WINDOW_N);
  if (!wl.length) return 0;
  let weighted = 0;
  let weightSum = 0;
  for (let i = 0; i < wl.length; i++) {
    const w = Math.pow(0.85, i);
    const actual = String(wl[i]!.actual ?? wl[i]!.predicted);
    const pts = actual === "win" ? 3 : actual === "draw" ? 1 : 0;
    weighted += pts * w;
    weightSum += w;
  }
  return weightSum > 0 ? Math.round((weighted / weightSum) * 100) / 100 : 0;
}

export function emptyStatMetadata(): ClubStatMetadata {
  return {
    attack_strength_home: 1,
    attack_strength_away: 1,
    defense_strength_home: 1,
    defense_strength_away: 1,
    goals_for_rolling: 0,
    goals_against_rolling: 0,
    xg_for: 0,
    xg_against: 0,
    form_points: 0,
    tier: null,
    sample_size: 0,
    lastUpdated: new Date().toISOString(),
  };
}

export function recomputeStatMetadata(
  record: ClubRecord,
  leagueBaselines: LeagueBaselinesStore | null,
  teamsQuality: TeamsQualityStore | null
): ClubStatMetadata {
  const baseline = getLeagueBaseline(leagueBaselines, record.league, {
    home: DEFAULT_LEAGUE_HOME_GOALS,
    away: DEFAULT_LEAGUE_AWAY_GOALS,
  });

  const goalsForHome = rollingNumeric(record.histories.goalsScored, "home");
  const goalsForAway = rollingNumeric(record.histories.goalsScored, "away");
  const goalsAgainstHome = rollingNumeric(record.histories.goalsConceded, "home");
  const goalsAgainstAway = rollingNumeric(record.histories.goalsConceded, "away");
  const goalsForAll = rollingNumeric(record.histories.goalsScored);
  const goalsAgainstAll = rollingNumeric(record.histories.goalsConceded);

  const sotHome = rollingNumeric(record.histories.shotsOnTarget, "home");
  const sotAway = rollingNumeric(record.histories.shotsOnTarget, "away");
  const sotAll = rollingNumeric(record.histories.shotsOnTarget);

  const attackHome = goalsForHome > 0 ? clampStrength(goalsForHome / baseline.league_avg_home_goals) : 1;
  const attackAway = goalsForAway > 0 ? clampStrength(goalsForAway / baseline.league_avg_away_goals) : 1;
  const defenseHome =
    goalsAgainstHome > 0 ? clampStrength(goalsAgainstHome / baseline.league_avg_away_goals) : 1;
  const defenseAway =
    goalsAgainstAway > 0 ? clampStrength(goalsAgainstAway / baseline.league_avg_home_goals) : 1;

  const xgFor = sotAll > 0 ? Math.round(sotAll * 0.12 * 100) / 100 : Math.round(goalsForAll * 0.95 * 100) / 100;
  const xgAgainst =
    sotAll > 0
      ? Math.round(goalsAgainstAll * 0.95 * 100) / 100
      : Math.round(goalsAgainstAll * 0.95 * 100) / 100;

  const tierEntry = lookupTeam(teamsQuality, record.clubName);
  const tier = (tierEntry?.tier ?? null) as QualityTier | null;

  return {
    attack_strength_home: attackHome,
    attack_strength_away: attackAway,
    defense_strength_home: defenseHome,
    defense_strength_away: defenseAway,
    goals_for_rolling: goalsForAll || goalsForHome || goalsForAway,
    goals_against_rolling: goalsAgainstAll || goalsAgainstHome || goalsAgainstAway,
    xg_for: xgFor,
    xg_against: xgAgainst,
    form_points: formPoints(record),
    tier,
    sample_size: record.capacity.sampleSize,
    lastUpdated: new Date().toISOString(),
  };
}

export function applyStatMetadata(
  record: ClubRecord,
  leagueBaselines: LeagueBaselinesStore | null,
  teamsQuality: TeamsQualityStore | null
): ClubRecord {
  return {
    ...record,
    statMetadata: recomputeStatMetadata(record, leagueBaselines, teamsQuality),
  };
}
