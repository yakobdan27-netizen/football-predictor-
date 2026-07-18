import { ftResult } from "./goal-result-sync";
import { leagueMetaForName, resolveLeagueId } from "./league-registry";
import {
  matchHasPenalties,
  resolveFirstGoalSide,
} from "./match-learning";
import { leagueProfileKey, seasonForDate } from "./season";
import type {
  GoalTimingCurve,
  League,
  LeagueCharacterProfile,
  LeagueCharacterTrait,
  LeagueConfidenceLevel,
  LeagueGoalTimingProfile,
  LeagueProfilesStore,
  LogMarketKey,
  LogMatch,
  PredictionBatch,
} from "./types";
import { LEAGUE_PROFILE_SCHEMA_VERSION } from "./types";
import { mergeSeedIntoLeagueProfiles } from "./league-seed-profiles";

const MIN_TRAIT_SAMPLE = 5;

function emptyTrait(): LeagueCharacterTrait {
  return { value: null, baselineDelta: null, sampleSize: 0 };
}

function emptyTimingCurve(): LeagueGoalTimingProfile {
  return {
    g0_15: 0,
    g16_30: 0,
    g31_45: 0,
    g46_60: 0,
    g61_75: 0,
    g76_90plus: 0,
    sampleSize: 0,
  };
}

export function emptyLeagueCharacterProfile(): LeagueCharacterProfile {
  return {
    early_goal_rate_0_10: emptyTrait(),
    first_half_goals_avg: emptyTrait(),
    second_half_goals_avg: emptyTrait(),
    half_dominance: emptyTrait(),
    late_goal_rate_80_90: emptyTrait(),
    goal_timing_curve: emptyTimingCurve(),
    goals_per_match_avg: emptyTrait(),
    over_2_5_rate: emptyTrait(),
    btts_rate: emptyTrait(),
    clean_sheet_rate: emptyTrait(),
    draw_rate: emptyTrait(),
    home_win_rate: emptyTrait(),
    offsides_per_match_avg: emptyTrait(),
    shots_per_match_avg: emptyTrait(),
    shots_on_target_avg: emptyTrait(),
    shot_conversion_rate: emptyTrait(),
    corners_per_match_avg: emptyTrait(),
    fouls_per_match_avg: emptyTrait(),
    yellow_cards_per_match_avg: emptyTrait(),
    red_card_rate: emptyTrait(),
    penalty_rate: emptyTrait(),
    comeback_rate: emptyTrait(),
    favourite_reliability: emptyTrait(),
    home_advantage_index: emptyTrait(),
    scoreline_predictability: emptyTrait(),
    tempo_index: emptyTrait(),
    first_goal_wins_rate: emptyTrait(),
    second_half_card_bias: emptyTrait(),
    late_drama_index: emptyTrait(),
  };
}

export function confidenceLevel(matchesLogged: number): LeagueConfidenceLevel {
  if (matchesLogged >= 50) return "high";
  if (matchesLogged >= 15) return "medium";
  return "low";
}

function parseNum(v: string | number | undefined): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

export function getMatchFtGoals(match: LogMatch): { home?: number; away?: number } {
  const home = match.teamStats?.home?.goals ?? parseNum(match.actualResults.home_goals_ou?.actual);
  const away = match.teamStats?.away?.goals ?? parseNum(match.actualResults.away_goals_ou?.actual);
  return { home, away };
}

function getMatchHtGoals(match: LogMatch): { home?: number; away?: number } {
  const home = match.teamStats?.home?.firstHalfGoals;
  const away = match.teamStats?.away?.firstHalfGoals;
  return { home, away };
}

function matchHasResult(match: LogMatch): boolean {
  const { home, away } = getMatchFtGoals(match);
  return home != null && away != null;
}

function pct(count: number, total: number): number | null {
  if (total < MIN_TRAIT_SAMPLE) return null;
  return Math.round((count / total) * 1000) / 10;
}

function avg(nums: number[]): number | null {
  if (nums.length < MIN_TRAIT_SAMPLE) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

interface MatchAccumulator {
  matches: LogMatch[];
}

function accumulateMatches(batches: PredictionBatch[]): Map<string, MatchAccumulator> {
  const map = new Map<string, MatchAccumulator>();
  for (const batch of batches) {
    const leagueId = batch.leagueId ?? resolveLeagueId(batch.league);
    const season = seasonForDate(batch.date);
    const key = leagueProfileKey(leagueId, season);
    const bucket = map.get(key) ?? { matches: [] };
    for (const match of batch.matches) {
      if (matchHasResult(match)) bucket.matches.push(match);
    }
    map.set(key, bucket);
  }
  return map;
}

function buildProfileFromMatches(
  matches: LogMatch[],
  baselines: Partial<Record<keyof LeagueCharacterProfile, number>>
): LeagueCharacterProfile {
  const profile = emptyLeagueCharacterProfile();
  const usable = matches.filter((m) => !m.teamStats?.abnormalMatch);
  const n = usable.length;
  if (n === 0) return profile;

  const totalGoals: number[] = [];
  const firstHalfGoals: number[] = [];
  const secondHalfGoals: number[] = [];
  let over25 = 0;
  let btts = 0;
  let cleanSheet = 0;
  let draws = 0;
  let homeWins = 0;
  let earlyGoal = 0;
  let lateGoal = 0;
  let penalties = 0;
  let redCards = 0;
  let comebacks = 0;
  let favouriteWins = 0;
  let favouriteTotal = 0;
  let firstGoalWins = 0;
  let firstGoalTotal = 0;
  let lateDrama = 0;
  let secondHalfCardMatches = 0;
  let cardMatches = 0;

  const offsides: number[] = [];
  const shots: number[] = [];
  const sot: number[] = [];
  const corners: number[] = [];
  const fouls: number[] = [];
  const yellows: number[] = [];
  const scorelines = new Map<string, number>();

  const curve: GoalTimingCurve = {
    g0_15: 0,
    g16_30: 0,
    g31_45: 0,
    g46_60: 0,
    g61_75: 0,
    g76_90plus: 0,
  };
  let curveMatches = 0;

  let homePts = 0;
  let awayPts = 0;
  let homeGames = 0;
  let awayGames = 0;

  for (const match of usable) {
    const { home: hg, away: ag } = getMatchFtGoals(match);
    if (hg == null || ag == null) continue;

    const tg = hg + ag;
    totalGoals.push(tg);
    if (tg > 2.5) over25++;
    if (hg >= 1 && ag >= 1) btts++;
    if (hg === 0 || ag === 0) cleanSheet++;
    const res = ftResult(hg, ag);
    if (res === "draw") draws++;
    if (res === "home") {
      homeWins++;
      homePts += 3;
    } else if (res === "away") {
      awayPts += 3;
    } else {
      homePts += 1;
      awayPts += 1;
    }
    homeGames++;
    awayGames++;

    const sl = `${hg}-${ag}`;
    scorelines.set(sl, (scorelines.get(sl) ?? 0) + 1);

    const gt = match.teamStats?.goalTiming;
    if (gt?.goalInFirst10) earlyGoal++;
    if (gt?.goalInLast10) lateGoal++;
    if (gt?.goalInFirst10 && (gt.goalInLast10 || tg >= 3)) lateDrama++;
    if (matchHasPenalties(match.teamStats)) penalties++;

    const { home: hth, away: ath } = getMatchHtGoals(match);
    if (hth != null && ath != null) {
      const fh = hth + ath;
      const sh = tg - fh;
      firstHalfGoals.push(fh);
      secondHalfGoals.push(sh);
    }

    if (gt?.timingBuckets) {
      curveMatches++;
      curve.g0_15 += gt.timingBuckets.g0_15;
      curve.g16_30 += gt.timingBuckets.g16_30;
      curve.g31_45 += gt.timingBuckets.g31_45;
      curve.g46_60 += gt.timingBuckets.g46_60;
      curve.g61_75 += gt.timingBuckets.g61_75;
      curve.g76_90plus += gt.timingBuckets.g76_90plus;
    }

    const ts = match.teamStats;
    if (ts) {
      const off = (ts.home.offsides ?? 0) + (ts.away.offsides ?? 0);
      if (ts.home.offsides != null && ts.away.offsides != null) offsides.push(off);
      const sh = (ts.home.totalShots ?? 0) + (ts.away.totalShots ?? 0);
      if (ts.home.totalShots != null && ts.away.totalShots != null) shots.push(sh);
      const sotVal = (ts.home.shotsOnTarget ?? 0) + (ts.away.shotsOnTarget ?? 0);
      if (ts.home.shotsOnTarget != null && ts.away.shotsOnTarget != null) sot.push(sotVal);
      const cor = (ts.home.corners ?? 0) + (ts.away.corners ?? 0);
      if (ts.home.corners != null && ts.away.corners != null) corners.push(cor);
      const foul = (ts.home.fouls ?? 0) + (ts.away.fouls ?? 0);
      if (ts.home.fouls != null && ts.away.fouls != null) fouls.push(foul);
      const yc = (ts.home.yellowCards ?? 0) + (ts.away.yellowCards ?? 0);
      if (ts.home.yellowCards != null && ts.away.yellowCards != null) yellows.push(yc);
      const rc = (ts.home.redCards ?? 0) + (ts.away.redCards ?? 0);
      if (rc > 0) redCards++;
      if (yc > 0 || rc > 0) {
        cardMatches++;
        if (gt?.secondHalfCards) secondHalfCardMatches++;
      }
    }

    const pick1x2 = match.predictions["1x2"];
    if (pick1x2) {
      favouriteTotal++;
      const fav =
        pick1x2.prediction === "home"
          ? "home"
          : pick1x2.prediction === "away"
            ? "away"
            : "draw";
      if (fav === res) favouriteWins++;
    }

    const firstGoal = resolveFirstGoalSide(match);
    if (firstGoal === "home" || firstGoal === "away") {
      firstGoalTotal++;
      if (firstGoal === res) {
        firstGoalWins++;
      }
    }

    if (hth != null && ath != null) {
      const htRes = ftResult(hth, ath);
      const htLeader = htRes;
      const ftLeader = res;
      if (
        (htLeader === "home" && ftLeader === "away") ||
        (htLeader === "away" && ftLeader === "home")
      ) {
        comebacks++;
      }
    }
  }

  const trait = (value: number | null, sample: number, key?: keyof LeagueCharacterProfile): LeagueCharacterTrait => {
    const base = key && baselines[key] != null ? baselines[key]! : null;
    return {
      value,
      baselineDelta: value != null && base != null ? Math.round((value - base) * 100) / 100 : null,
      sampleSize: sample,
    };
  };

  const fhAvg = avg(firstHalfGoals);
  const shAvg = avg(secondHalfGoals);
  const halfDom =
    fhAvg != null && shAvg != null && fhAvg > 0 ? Math.round((shAvg / fhAvg) * 100) / 100 : null;

  const sotAvg = avg(sot);
  const goalsAvg = avg(totalGoals);
  const conv =
    sotAvg != null && goalsAvg != null && sotAvg > 0
      ? Math.round((goalsAvg / sotAvg) * 1000) / 1000
      : null;

  const homePpg = homeGames > 0 ? homePts / homeGames : 0;
  const awayPpg = awayGames > 0 ? awayPts / awayGames : 0;
  const homeAdv = homeGames >= MIN_TRAIT_SAMPLE ? Math.round((homePpg - awayPpg) * 100) / 100 : null;

  let entropy = 0;
  for (const count of scorelines.values()) {
    const p = count / n;
    entropy -= p * Math.log2(p);
  }
  const maxEntropy = Math.log2(Math.max(scorelines.size, 2));
  const predictability =
    n >= MIN_TRAIT_SAMPLE && maxEntropy > 0
      ? Math.round((1 - entropy / maxEntropy) * 1000) / 10
      : null;

  const shotsAvg = avg(shots);
  const cornersAvg = avg(corners);
  const tempo =
    shotsAvg != null && goalsAvg != null && cornersAvg != null
      ? Math.round((shotsAvg * 0.4 + goalsAvg * 10 + cornersAvg * 0.5) * 10) / 10
      : null;

  profile.early_goal_rate_0_10 = trait(pct(earlyGoal, n), n, "early_goal_rate_0_10");
  profile.first_half_goals_avg = trait(fhAvg, firstHalfGoals.length, "first_half_goals_avg");
  profile.second_half_goals_avg = trait(shAvg, secondHalfGoals.length, "second_half_goals_avg");
  profile.half_dominance = trait(halfDom, firstHalfGoals.length, "half_dominance");
  profile.late_goal_rate_80_90 = trait(pct(lateGoal, n), n, "late_goal_rate_80_90");
  profile.goal_timing_curve = { ...curve, sampleSize: curveMatches };
  profile.goals_per_match_avg = trait(goalsAvg, totalGoals.length, "goals_per_match_avg");
  profile.over_2_5_rate = trait(pct(over25, n), n, "over_2_5_rate");
  profile.btts_rate = trait(pct(btts, n), n, "btts_rate");
  profile.clean_sheet_rate = trait(pct(cleanSheet, n), n, "clean_sheet_rate");
  profile.draw_rate = trait(pct(draws, n), n, "draw_rate");
  profile.home_win_rate = trait(pct(homeWins, n), n, "home_win_rate");
  profile.offsides_per_match_avg = trait(avg(offsides), offsides.length, "offsides_per_match_avg");
  profile.shots_per_match_avg = trait(shotsAvg, shots.length, "shots_per_match_avg");
  profile.shots_on_target_avg = trait(sotAvg, sot.length, "shots_on_target_avg");
  profile.shot_conversion_rate = trait(conv, sot.length, "shot_conversion_rate");
  profile.corners_per_match_avg = trait(cornersAvg, corners.length, "corners_per_match_avg");
  profile.fouls_per_match_avg = trait(avg(fouls), fouls.length, "fouls_per_match_avg");
  profile.yellow_cards_per_match_avg = trait(avg(yellows), yellows.length, "yellow_cards_per_match_avg");
  profile.red_card_rate = trait(pct(redCards, n), n, "red_card_rate");
  profile.penalty_rate = trait(pct(penalties, n), n, "penalty_rate");
  profile.comeback_rate = trait(pct(comebacks, n), n, "comeback_rate");
  profile.favourite_reliability = trait(
    favouriteTotal >= MIN_TRAIT_SAMPLE ? pct(favouriteWins, favouriteTotal) : null,
    favouriteTotal,
    "favourite_reliability"
  );
  profile.home_advantage_index = trait(homeAdv, homeGames, "home_advantage_index");
  profile.scoreline_predictability = trait(predictability, n, "scoreline_predictability");
  profile.tempo_index = trait(tempo, n, "tempo_index");
  profile.first_goal_wins_rate = trait(
    firstGoalTotal >= MIN_TRAIT_SAMPLE ? pct(firstGoalWins, firstGoalTotal) : null,
    firstGoalTotal,
    "first_goal_wins_rate"
  );
  profile.second_half_card_bias = trait(
    cardMatches >= MIN_TRAIT_SAMPLE ? pct(secondHalfCardMatches, cardMatches) : null,
    cardMatches,
    "second_half_card_bias"
  );
  profile.late_drama_index = trait(pct(lateDrama, n), n, "late_drama_index");

  return profile;
}

function computeBaselines(leagues: League[]): Partial<Record<keyof LeagueCharacterProfile, number>> {
  const sums: Partial<Record<keyof LeagueCharacterProfile, { total: number; count: number }>> = {};
  const traitKeys = Object.keys(emptyLeagueCharacterProfile()) as (keyof LeagueCharacterProfile)[];

  for (const league of leagues) {
    for (const key of traitKeys) {
      if (key === "goal_timing_curve") continue;
      const t = league.characterProfile[key] as LeagueCharacterTrait;
      if (t.value == null || t.sampleSize < MIN_TRAIT_SAMPLE) continue;
      const bucket = sums[key] ?? { total: 0, count: 0 };
      bucket.total += t.value;
      bucket.count++;
      sums[key] = bucket;
    }
  }

  const baselines: Partial<Record<keyof LeagueCharacterProfile, number>> = {};
  for (const [key, bucket] of Object.entries(sums)) {
    if (bucket.count > 0) {
      baselines[key as keyof LeagueCharacterProfile] = bucket.total / bucket.count;
    }
  }
  return baselines;
}

function setByPath<T extends object>(obj: T, path: string, value: unknown): T {
  const parts = path.split(".");
  const out = { ...obj } as Record<string, unknown>;
  let cur: Record<string, unknown> = out;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    cur[p] = { ...(cur[p] as Record<string, unknown>) };
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
  return out as T;
}

export function mergeWithManualOverrides(
  profile: LeagueCharacterProfile,
  manualPaths: string[]
): LeagueCharacterProfile {
  return profile;
}

export function recomputeLeagueProfiles(
  batches: PredictionBatch[],
  existing?: LeagueProfilesStore | null
): LeagueProfilesStore {
  const grouped = accumulateMatches(batches);
  const draftLeagues: League[] = [];

  for (const [key, { matches }] of grouped) {
    const [leagueId, season] = key.split("::") as [string, string];
    const meta = leagueMetaForName(
      batches.find((b) => (b.leagueId ?? resolveLeagueId(b.league)) === leagueId)?.league ??
        leagueId.replace(/_/g, " ")
    );
    const profile = buildProfileFromMatches(matches, {});
    draftLeagues.push({
      leagueId,
      leagueName: meta.leagueName,
      country: meta.country,
      season,
      matchesLogged: matches.length,
      characterProfile: profile,
      confidenceLevel: confidenceLevel(matches.length),
      lastUpdated: new Date().toISOString(),
    });
  }

  const baselines = computeBaselines(draftLeagues);
  const leagues: Record<string, League> = {};

  for (const league of draftLeagues) {
    const key = leagueProfileKey(league.leagueId, league.season);
    const acc = grouped.get(key)!;
    let profile = buildProfileFromMatches(acc.matches, baselines);
    const manual = existing?.manualFields[key] ?? [];
    for (const path of manual) {
      const existingLeague = existing?.leagues[key];
      if (!existingLeague) continue;
      const parts = path.split(".");
      if (parts.length === 2 && parts[0] === "characterProfile") {
        const traitKey = parts[1] as keyof LeagueCharacterProfile;
        if (traitKey === "goal_timing_curve") continue;
        const oldTrait = existingLeague.characterProfile[traitKey] as LeagueCharacterTrait;
        (profile[traitKey] as LeagueCharacterTrait) = { ...oldTrait, manual: true };
      }
    }
    leagues[key] = { ...league, characterProfile: profile };
  }

  const liveStore = {
    schemaVersion: LEAGUE_PROFILE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    leagues: Object.fromEntries(
      Object.entries(leagues).map(([k, v]) => [k, { ...v, dataSource: "live" as const }])
    ),
    manualFields: existing?.manualFields ?? {},
  };
  return mergeSeedIntoLeagueProfiles(liveStore);
}

export function saveManualLeagueField(
  store: LeagueProfilesStore,
  leagueKey: string,
  traitKey: keyof LeagueCharacterProfile,
  value: number
): LeagueProfilesStore {
  const league = store.leagues[leagueKey];
  if (!league || traitKey === "goal_timing_curve") return store;

  const manual = new Set(store.manualFields[leagueKey] ?? []);
  manual.add(`characterProfile.${traitKey}`);

  const existingTrait = league.characterProfile[traitKey] as LeagueCharacterTrait;
  const updatedTrait: LeagueCharacterTrait = {
    value,
    baselineDelta: existingTrait.baselineDelta,
    sampleSize: league.matchesLogged,
    manual: true,
  };

  return {
    ...store,
    updatedAt: new Date().toISOString(),
    leagues: {
      ...store.leagues,
      [leagueKey]: {
        ...league,
        characterProfile: {
          ...league.characterProfile,
          [traitKey]: updatedTrait,
        },
      },
    },
    manualFields: { ...store.manualFields, [leagueKey]: [...manual] },
  };
}

export function resolveLeagueCharacterProfile(
  store: LeagueProfilesStore | null | undefined,
  leagueName: string,
  batchDate: string
): LeagueCharacterProfile | null {
  if (!store) return null;
  const leagueId = resolveLeagueId(leagueName);
  const season = seasonForDate(batchDate);
  return getLeagueProfile(store, leagueId, season)?.characterProfile ?? null;
}

export function getLeagueProfile(
  store: LeagueProfilesStore | null | undefined,
  leagueId: string,
  season: string
): League | null {
  if (!store) return null;
  return store.leagues[leagueProfileKey(leagueId, season)] ?? null;
}

export function emptyLeagueProfilesStore(): LeagueProfilesStore {
  return {
    schemaVersion: LEAGUE_PROFILE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    leagues: {},
    manualFields: {},
  };
}

export const LEAGUE_TRAIT_GROUPS: Array<{
  title: string;
  traits: Array<{ key: keyof LeagueCharacterProfile; label: string }>;
}> = [
  {
    title: "Goal timing",
    traits: [
      { key: "early_goal_rate_0_10", label: "Early goal rate (0–10 min) %" },
      { key: "first_half_goals_avg", label: "First half goals avg" },
      { key: "second_half_goals_avg", label: "Second half goals avg" },
      { key: "half_dominance", label: "Half dominance (2H÷1H)" },
      { key: "late_goal_rate_80_90", label: "Late goal rate (80–90+) %" },
    ],
  },
  {
    title: "Scoring volume & shape",
    traits: [
      { key: "goals_per_match_avg", label: "Goals per match" },
      { key: "over_2_5_rate", label: "Over 2.5 rate %" },
      { key: "btts_rate", label: "BTTS rate %" },
      { key: "clean_sheet_rate", label: "Clean sheet rate %" },
      { key: "draw_rate", label: "Draw rate %" },
      { key: "home_win_rate", label: "Home win rate %" },
    ],
  },
  {
    title: "Match events",
    traits: [
      { key: "offsides_per_match_avg", label: "Offsides per match" },
      { key: "shots_per_match_avg", label: "Shots per match" },
      { key: "shots_on_target_avg", label: "Shots on target per match" },
      { key: "shot_conversion_rate", label: "Shot conversion rate" },
      { key: "corners_per_match_avg", label: "Corners per match" },
      { key: "fouls_per_match_avg", label: "Fouls per match" },
    ],
  },
  {
    title: "Discipline",
    traits: [
      { key: "yellow_cards_per_match_avg", label: "Yellow cards per match" },
      { key: "red_card_rate", label: "Red card rate %" },
      { key: "penalty_rate", label: "Penalty rate %" },
    ],
  },
  {
    title: "Structural traits",
    traits: [
      { key: "comeback_rate", label: "Comeback rate %" },
      { key: "favourite_reliability", label: "Favourite reliability %" },
      { key: "home_advantage_index", label: "Home advantage index" },
      { key: "scoreline_predictability", label: "Scoreline predictability %" },
      { key: "tempo_index", label: "Tempo index" },
      { key: "first_goal_wins_rate", label: "First goal wins rate %" },
      { key: "second_half_card_bias", label: "Second half card bias %" },
      { key: "late_drama_index", label: "Late drama index %" },
    ],
  },
];
