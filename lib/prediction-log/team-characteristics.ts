import type {
  LogMatch,
  PredictionBatch,
  TeamAdditionalCharacteristics,
  TeamAttackingCharacteristics,
  TeamCharacteristics,
  TeamCharacteristicsStore,
  TeamDefendingCharacteristics,
  TeamGoalsCharacteristics,
  TeamOffsideCharacteristics,
  TeamShootingCharacteristics,
  TeamThroughPassingCharacteristics,
  AttackingStyle,
  DefensiveStyle,
} from "./types";
import { TEAM_CHARACTERISTICS_SCHEMA_VERSION } from "./types";

export const TEAM_CHARACTERISTICS_KEY = "pl_team_characteristics";

export function teamCharacteristicsId(league: string, clubName: string): string {
  return `${league}::${clubName}`;
}

interface ClubMatchSample {
  date: string;
  venue: "home" | "away";
  goalsFor: number | null;
  goalsAgainst: number | null;
  cleanSheet: boolean;
  matchShots: number | null;
  matchSot: number | null;
  matchCorners: number | null;
  matchOffsides: number | null;
  points: number | null;
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function pct(nums: number[]): number {
  if (!nums.length) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function splitMatchTotal(total: number, venue: "home" | "away"): number {
  const homeShare = 0.55;
  const share = venue === "home" ? homeShare : 1 - homeShare;
  return Math.round(total * share * 10) / 10;
}

function resultPoints(actual: string, venue: "home" | "away"): number | null {
  if (actual === "draw") return 1;
  if (actual === "home") return venue === "home" ? 3 : 0;
  if (actual === "away") return venue === "away" ? 3 : 0;
  return null;
}

function extractNumericActual(match: LogMatch, key: keyof LogMatch["actualResults"]): number | null {
  const raw = match.actualResults[key]?.actual;
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

function extractMatchSamples(
  batch: PredictionBatch,
  match: LogMatch
): { home: ClubMatchSample; away: ClubMatchSample } | null {
  const homeGoals = extractNumericActual(match, "home_goals_ou");
  const awayGoals = extractNumericActual(match, "away_goals_ou");
  const ix2 = match.actualResults["1x2"]?.actual;

  let hg = homeGoals;
  let ag = awayGoals;
  if (hg == null && ag == null && typeof ix2 === "string") {
    return null;
  }

  const shots = extractNumericActual(match, "shots_ou");
  const sot = extractNumericActual(match, "sot_ou");
  const corners = extractNumericActual(match, "corners_ou");
  const offsides = extractNumericActual(match, "offsides_ou");

  const homePoints = typeof ix2 === "string" ? resultPoints(ix2, "home") : null;
  const awayPoints = typeof ix2 === "string" ? resultPoints(ix2, "away") : null;

  const home: ClubMatchSample = {
    date: batch.date,
    venue: "home",
    goalsFor: hg,
    goalsAgainst: ag,
    cleanSheet: ag === 0,
    matchShots: shots,
    matchSot: sot,
    matchCorners: corners,
    matchOffsides: offsides,
    points: homePoints,
  };

  const away: ClubMatchSample = {
    date: batch.date,
    venue: "away",
    goalsFor: ag,
    goalsAgainst: hg,
    cleanSheet: hg === 0,
    matchShots: shots,
    matchSot: sot,
    matchCorners: corners,
    matchOffsides: offsides,
    points: awayPoints,
  };

  const hasData =
    hg != null ||
    ag != null ||
    shots != null ||
    sot != null ||
    corners != null ||
    offsides != null ||
    homePoints != null;

  return hasData ? { home, away } : null;
}

function inferAttackingStyle(
  goalsScored: number,
  shotVolume: number,
  counterEff: number
): AttackingStyle {
  if (goalsScored >= 2 && shotVolume >= 12) return "direct";
  if (counterEff >= 7) return "counter";
  if (goalsScored <= 1.1 && shotVolume <= 10) return "possession";
  return "mixed";
}

function inferDefensiveStyle(
  goalsConceded: number,
  cleanSheetRate: number,
  pressure: number
): DefensiveStyle {
  if (cleanSheetRate >= 35) return "low-block";
  if (pressure >= 7) return "pressing";
  if (goalsConceded >= 1.8) return "high-line";
  return "mid-block";
}

function buildCharacteristics(
  league: string,
  clubName: string,
  samples: ClubMatchSample[]
): TeamCharacteristics {
  const clubId = teamCharacteristicsId(league, clubName);
  const homeSamples = samples.filter((s) => s.venue === "home");
  const awaySamples = samples.filter((s) => s.venue === "away");
  const recent = [...samples].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  const goalsFor = samples.map((s) => s.goalsFor).filter((n): n is number => n != null);
  const goalsAgainst = samples.map((s) => s.goalsAgainst).filter((n): n is number => n != null);
  const goalsScoredAvg = avg(goalsFor);
  const goalsConcededAvg = avg(goalsAgainst);

  const shotVolumes = samples
    .filter((s) => s.matchShots != null)
    .map((s) => splitMatchTotal(s.matchShots!, s.venue));
  const sotVolumes = samples
    .filter((s) => s.matchSot != null)
    .map((s) => splitMatchTotal(s.matchSot!, s.venue));
  const offsideVolumes = samples
    .filter((s) => s.matchOffsides != null)
    .map((s) => splitMatchTotal(s.matchOffsides!, s.venue));

  const shotVolume = avg(shotVolumes);
  const shotsOnTarget = avg(sotVolumes);
  const shotAccuracy =
    shotVolume > 0 && shotsOnTarget > 0
      ? clamp(Math.round((shotsOnTarget / shotVolume) * 100), 0, 100)
      : 0;

  const cleanSheets = samples.filter((s) => s.cleanSheet && s.goalsAgainst === 0).length;
  const cleanSheetRate =
    samples.length > 0 ? Math.round((cleanSheets / samples.length) * 100) : 0;

  const homePoints = homeSamples.map((s) => s.points).filter((n): n is number => n != null);
  const awayPoints = awaySamples.map((s) => s.points).filter((n): n is number => n != null);
  const homePerformance =
    homePoints.length > 0
      ? clamp(Math.round((avg(homePoints) / 3) * 10), 0, 10)
      : 5;
  const awayPerformance =
    awayPoints.length > 0
      ? clamp(Math.round((avg(awayPoints) / 3) * 10), 0, 10)
      : 5;

  const recentPoints = recent.map((s) => s.points).filter((n): n is number => n != null);
  const recentForm =
    recentPoints.length > 0
      ? clamp(Math.round((avg(recentPoints) / 3) * 10), 0, 10)
      : 5;

  const counterAttackEfficiency =
    awayPerformance > homePerformance + 1
      ? clamp(awayPerformance - homePerformance + 5, 0, 10)
      : 5;

  const attacking: TeamAttackingCharacteristics = {
    attackingStyle: inferAttackingStyle(goalsScoredAvg, shotVolume, counterAttackEfficiency),
    shotVolume: clamp(shotVolume, 0, 30),
    shotAccuracy,
    bigChanceCreation: clamp(goalsScoredAvg * 1.5, 0, 10),
    throughBallFrequency: clamp(goalsScoredAvg, 0, 10),
    crossingAccuracy: clamp(50 + (goalsScoredAvg - 1) * 10, 0, 100),
    setPieceAttack: clamp(goalsScoredAvg * 2, 0, 10),
  };

  const defending: TeamDefendingCharacteristics = {
    defensiveStyle: inferDefensiveStyle(goalsConcededAvg, cleanSheetRate, 5),
    cleanSheetRate,
    tacklesPerGame: clamp(15 - goalsConcededAvg * 2, 0, 30),
    interceptionsPerGame: clamp(10 - goalsConcededAvg, 0, 20),
    aerialDuelsWon: clamp(50 + (goalsConcededAvg < 1 ? 10 : -5), 0, 100),
    pressureIntensity: clamp(10 - goalsConcededAvg * 2, 0, 10),
  };

  const goals: TeamGoalsCharacteristics = {
    goalsScoredAvg,
    goalsConcededAvg,
    goalConversionRate:
      shotVolume > 0 ? clamp(Math.round((goalsScoredAvg / shotVolume) * 100), 0, 100) : 0,
    xGPerGame: clamp(goalsScoredAvg * 0.95, 0, 5),
    xGAConcededPerGame: clamp(goalsConcededAvg * 0.95, 0, 5),
  };

  const offside: TeamOffsideCharacteristics = {
    offsidesPerGame: clamp(avg(offsideVolumes), 0, 15),
    offsideTrapSuccess: clamp(10 - avg(offsideVolumes), 0, 10),
  };

  const throughPassing: TeamThroughPassingCharacteristics = {
    throughBallsPerGame: clamp(goalsScoredAvg * 2, 0, 15),
    keyPassesPerGame: clamp(shotsOnTarget * 0.8, 0, 20),
    progressivePassesPerGame: clamp(shotVolume * 1.2, 0, 30),
  };

  const shooting: TeamShootingCharacteristics = {
    shotsOnTargetPerGame: clamp(shotsOnTarget, 0, 15),
    shotsOutsideBoxPerGame: clamp(Math.max(0, shotVolume - shotsOnTarget), 0, 10),
    longRangeThreat: clamp((shotVolume - shotsOnTarget) / 3, 0, 10),
  };

  const additional: TeamAdditionalCharacteristics = {
    possessionAvg: clamp(50 + (goalsScoredAvg - goalsConcededAvg) * 5, 30, 70),
    passAccuracy: clamp(75 + attacking.attackingStyle === "possession" ? 10 : 0, 0, 100),
    counterAttackEfficiency: counterAttackEfficiency,
    homePerformance,
    awayPerformance,
    recentForm,
    discipline: clamp(2 + goalsConcededAvg, 0, 10),
  };

  return {
    clubId,
    clubName,
    league,
    lastUpdated: new Date().toISOString(),
    matchSamples: samples.length,
    attacking,
    defending,
    goals,
    offside,
    throughPassing,
    shooting,
    additional,
  };
}

function getByPath(obj: TeamCharacteristics, path: string): unknown {
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj as unknown);
}

function setByPath(obj: TeamCharacteristics, path: string, value: unknown): TeamCharacteristics {
  const keys = path.split(".");
  const clone = JSON.parse(JSON.stringify(obj)) as TeamCharacteristics;
  let cur: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur[keys[i]!] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
  return clone;
}

function mergeManualFields(
  computed: TeamCharacteristics,
  previous: TeamCharacteristics | undefined,
  manualPaths: string[]
): TeamCharacteristics {
  if (!previous || !manualPaths.length) return computed;
  let merged = computed;
  for (const path of manualPaths) {
    const val = getByPath(previous, path);
    if (val !== undefined) merged = setByPath(merged, path, val);
  }
  return merged;
}

export function emptyTeamCharacteristicsStore(): TeamCharacteristicsStore {
  return {
    schemaVersion: TEAM_CHARACTERISTICS_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    teams: {},
    manualFields: {},
  };
}

export function recomputeTeamCharacteristics(
  batches: PredictionBatch[],
  existing: TeamCharacteristicsStore | null = null
): TeamCharacteristicsStore {
  const samplesByClub = new Map<string, ClubMatchSample[]>();
  const metaByClub = new Map<string, { league: string; clubName: string }>();

  for (const batch of batches) {
    for (const match of batch.matches) {
      const extracted = extractMatchSamples(batch, match);
      if (!extracted) continue;

      for (const side of [
        { club: match.homeTeam, sample: extracted.home },
        { club: match.awayTeam, sample: extracted.away },
      ]) {
        const id = teamCharacteristicsId(batch.league, side.club);
        metaByClub.set(id, { league: batch.league, clubName: side.club });
        const list = samplesByClub.get(id) ?? [];
        list.push(side.sample);
        samplesByClub.set(id, list);
      }
    }
  }

  const teams: Record<string, TeamCharacteristics> = {};
  for (const [id, samples] of samplesByClub) {
    const meta = metaByClub.get(id)!;
    const computed = buildCharacteristics(meta.league, meta.clubName, samples);
    const manualPaths = existing?.manualFields[id] ?? [];
    const previous = existing?.teams[id];
    teams[id] = mergeManualFields(computed, previous, manualPaths);
    teams[id].lastUpdated = new Date().toISOString();
  }

  return {
    schemaVersion: TEAM_CHARACTERISTICS_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    teams,
    manualFields: existing?.manualFields ?? {},
  };
}

export function listTeamCharacteristics(store: TeamCharacteristicsStore): TeamCharacteristics[] {
  return Object.values(store.teams).sort((a, b) =>
    `${a.league}${a.clubName}`.localeCompare(`${b.league}${b.clubName}`)
  );
}

export function getTeamCharacteristics(
  store: TeamCharacteristicsStore,
  league: string,
  clubName: string
): TeamCharacteristics | null {
  return store.teams[teamCharacteristicsId(league, clubName)] ?? null;
}

export function saveManualTeamField(
  store: TeamCharacteristicsStore,
  clubId: string,
  fieldPath: string,
  value: unknown
): TeamCharacteristicsStore {
  const team = store.teams[clubId];
  if (!team) return store;

  const manual = new Set(store.manualFields[clubId] ?? []);
  manual.add(fieldPath);

  return {
    ...store,
    updatedAt: new Date().toISOString(),
    teams: {
      ...store.teams,
      [clubId]: setByPath(team, fieldPath, value),
    },
    manualFields: {
      ...store.manualFields,
      [clubId]: [...manual],
    },
  };
}

/** Matchup score 0–100 for AI Learner (higher = safer characteristics fit). */
export function teamCharacteristicsMatchScore(
  homeTeam: string,
  awayTeam: string,
  league: string,
  store: TeamCharacteristicsStore | null,
  marketHint?: "goals" | "shots" | "offsides" | "general"
): { score: number; reason: string } {
  if (!store) return { score: 50, reason: "No team characteristics yet." };

  const home = getTeamCharacteristics(store, league, homeTeam);
  const away = getTeamCharacteristics(store, league, awayTeam);
  if (!home && !away) return { score: 50, reason: "Teams not in characteristics store." };

  let score = 55;
  const notes: string[] = [];

  for (const [label, team] of [
    ["Home", home],
    ["Away", away],
  ] as const) {
    if (!team) continue;
    if (team.matchSamples < 2) {
      notes.push(`${label} low sample`);
      score -= 5;
      continue;
    }
    if (team.additional.recentForm >= 7) {
      score += 8;
      notes.push(`${team.clubName} strong form (${team.additional.recentForm}/10)`);
    } else if (team.additional.recentForm <= 3) {
      score -= 12;
      notes.push(`${team.clubName} poor form (${team.additional.recentForm}/10)`);
    }
    if (team.goals.goalsConcededAvg >= 2) {
      score -= 6;
      notes.push(`${team.clubName} leaky defence (${team.goals.goalsConcededAvg} conceded/game)`);
    }
  }

  if (marketHint === "goals" && home && away) {
    const combinedGoals = home.goals.goalsScoredAvg + away.goals.goalsScoredAvg;
    if (combinedGoals >= 2.5) score += 5;
  }
  if (marketHint === "shots" && home) {
    if (home.attacking.shotVolume >= 12) score += 5;
  }
  if (marketHint === "offsides" && home) {
    if (home.offside.offsidesPerGame >= 2) score -= 5;
  }

  return {
    score: clamp(Math.round(score), 0, 100),
    reason: notes.length ? notes.join("; ") : "Characteristics neutral.",
  };
}

export function isRiskyCharacteristicsMatchup(
  homeTeam: string,
  awayTeam: string,
  league: string,
  store: TeamCharacteristicsStore | null
): { risky: boolean; reason?: string } {
  const { score, reason } = teamCharacteristicsMatchScore(
    homeTeam,
    awayTeam,
    league,
    store,
    "general"
  );
  if (score < 42) return { risky: true, reason };
  return { risky: false };
}

export function marketHintFromKey(
  market: string
): "goals" | "shots" | "offsides" | "general" {
  if (market.includes("goals") || market === "btts" || market === "1x2") return "goals";
  if (market.includes("shots") || market === "sot_ou" || market.includes("sot")) return "shots";
  if (market.includes("offside")) return "offsides";
  return "general";
}
