import { flattenScoredRows } from "./analysis";
import { isValidOdds } from "./odds-bands";
import type {
  ClubOddsRangeId,
  ClubOddsRangeStats,
  ClubProfile,
  ClubProfileMetrics,
  ClubProfilesStore,
  ClubRecentMatch,
  ClubStreakStats,
  HitStats,
  LogMarketKey,
  PredictionBatch,
  ScoredRow,
  ScoreResult,
} from "./types";
import { SCHEMA_VERSION } from "./types";

export const CLUB_PROFILES_KEY = "club_profiles";
export const CLUB_PROFILE_VERSION = 1;
export const RECENT_MATCHES_LIMIT = 10;
export const RECENT_WEIGHT_MATCHES = 8;
export const RECENT_WEIGHT_FACTOR = 2;

const BTTS_ODDS_RANGES: ClubOddsRangeId[] = ["1.50-2.00", "2.01-2.50", "2.51-3.00"];
const HIGH_RISK_ODDS = 2.6;

export function clubProfileId(league: string, clubName: string): string {
  return `${league}::${clubName}`;
}

function emptyHit(): HitStats {
  return { correct: 0, wrong: 0, push: 0, pct: null, sample: 0 };
}

function emptyStreaks(): ClubStreakStats {
  return {
    currentOverStreak: 0,
    currentUnderStreak: 0,
    currentWinStreak: 0,
    maxOverStreak: 0,
    maxUnderStreak: 0,
  };
}

function emptyOddsRanges(): ClubOddsRangeStats[] {
  return BTTS_ODDS_RANGES.map((range) => ({
    range,
    correct: 0,
    wrong: 0,
    pct: null,
    sample: 0,
  }));
}

function emptyMetrics(): ClubProfileMetrics {
  return {
    result1x2: emptyHit(),
    doubleChance: emptyHit(),
    btts: emptyHit(),
    bttsByOddsRange: emptyOddsRanges(),
    overUnderGoals: emptyHit(),
    firstHalfSecondHalf: emptyHit(),
    numericLines: { shots: emptyHit(), sot: emptyHit(), corners: emptyHit() },
    homeRecord: emptyHit(),
    awayRecord: emptyHit(),
    highRisk: emptyHit(),
    streaks: emptyStreaks(),
  };
}

function finalizeHit(h: HitStats): HitStats {
  const sample = h.correct + h.wrong;
  return {
    ...h,
    sample,
    pct: sample > 0 ? Math.round((h.correct / sample) * 100) : null,
  };
}

function addResult(h: HitStats, result: ScoreResult, weight = 1): void {
  if (result === "correct") h.correct += weight;
  else if (result === "wrong") h.wrong += weight;
  else if (result === "push") h.push += weight;
}

function clubOddsRange(odds: number): ClubOddsRangeId | null {
  if (odds >= 1.5 && odds <= 2.0) return "1.50-2.00";
  if (odds >= 2.01 && odds <= 2.5) return "2.01-2.50";
  if (odds >= 2.51 && odds <= 3.0) return "2.51-3.00";
  return null;
}

interface ClubPickEvent {
  batchId: string;
  date: string;
  league: string;
  club: string;
  opponent: string;
  venue: "home" | "away";
  market: LogMarketKey;
  prediction: string;
  line?: number;
  odds?: number;
  result: ScoreResult;
  weight: number;
  matchKey: string;
}

function marketBucket(
  market: LogMarketKey
): keyof ClubProfileMetrics | "numeric" | null {
  switch (market) {
    case "1x2":
    case "ht_1x2":
      return "result1x2";
    case "double_chance":
      return "doubleChance";
    case "btts":
      return "btts";
    case "home_goals_ou":
    case "away_goals_ou":
      return "overUnderGoals";
    case "more_goals_half":
    case "draw_one_half":
    case "win_one_half":
      return "firstHalfSecondHalf";
    case "shots_ou":
    case "sot_ou":
    case "corners_ou":
      return "numeric";
    default:
      return null;
  }
}

function numericKey(market: LogMarketKey): keyof ClubProfileMetrics["numericLines"] | null {
  if (market === "shots_ou") return "shots";
  if (market === "sot_ou") return "sot";
  if (market === "corners_ou") return "corners";
  return null;
}

function applyEvent(metrics: ClubProfileMetrics, e: ClubPickEvent): void {
  if (e.result !== "correct" && e.result !== "wrong" && e.result !== "push") return;

  const bucket = marketBucket(e.market);
  if (bucket === "numeric") {
    const nk = numericKey(e.market);
    if (nk) addResult(metrics.numericLines[nk], e.result, e.weight);
  } else if (bucket) {
    const target = metrics[bucket] as HitStats;
    addResult(target, e.result, e.weight);
  }

  if (e.market === "btts" && e.odds != null && isValidOdds(e.odds)) {
    const range = clubOddsRange(e.odds);
    if (range && (e.result === "correct" || e.result === "wrong")) {
      const band = metrics.bttsByOddsRange.find((b) => b.range === range)!;
      if (e.result === "correct") band.correct += e.weight;
      else band.wrong += e.weight;
    }
  }

  if (e.odds != null && isValidOdds(e.odds) && e.odds > HIGH_RISK_ODDS) {
    if (e.result === "correct" || e.result === "wrong") {
      addResult(metrics.highRisk, e.result, e.weight);
    }
  }

  const venueRecord = e.venue === "home" ? metrics.homeRecord : metrics.awayRecord;
  if (e.result === "correct" || e.result === "wrong") {
    addResult(venueRecord, e.result, e.weight);
  }
}

function finalizeMetrics(m: ClubProfileMetrics): ClubProfileMetrics {
  const out = { ...m, streaks: { ...m.streaks } };
  out.result1x2 = finalizeHit(out.result1x2);
  out.doubleChance = finalizeHit(out.doubleChance);
  out.btts = finalizeHit(out.btts);
  out.overUnderGoals = finalizeHit(out.overUnderGoals);
  out.firstHalfSecondHalf = finalizeHit(out.firstHalfSecondHalf);
  out.homeRecord = finalizeHit(out.homeRecord);
  out.awayRecord = finalizeHit(out.awayRecord);
  out.highRisk = finalizeHit(out.highRisk);
  out.numericLines = {
    shots: finalizeHit(out.numericLines.shots),
    sot: finalizeHit(out.numericLines.sot),
    corners: finalizeHit(out.numericLines.corners),
  };
  out.bttsByOddsRange = out.bttsByOddsRange.map((b) => {
    const sample = b.correct + b.wrong;
    return { ...b, sample, pct: sample > 0 ? Math.round((b.correct / sample) * 100) : null };
  });
  return out;
}

function computeStreaks(events: ClubPickEvent[]): ClubStreakStats {
  const sorted = [...events].sort((a, b) => a.matchKey.localeCompare(b.matchKey));
  const streaks = emptyStreaks();
  let curOver = 0;
  let curUnder = 0;
  let curWin = 0;

  for (const e of sorted) {
    if (e.result !== "correct" && e.result !== "wrong") continue;
    const isWin = e.result === "correct";

    if (e.prediction === "over") {
      curOver = isWin ? curOver + 1 : 0;
      curUnder = 0;
      streaks.maxOverStreak = Math.max(streaks.maxOverStreak, curOver);
    } else if (e.prediction === "under") {
      curUnder = isWin ? curUnder + 1 : 0;
      curOver = 0;
      streaks.maxUnderStreak = Math.max(streaks.maxUnderStreak, curUnder);
    }

    if (e.market === "1x2" || e.market === "ht_1x2") {
      curWin = isWin ? curWin + 1 : 0;
    }
  }

  streaks.currentOverStreak = curOver;
  streaks.currentUnderStreak = curUnder;
  streaks.currentWinStreak = curWin;
  return streaks;
}

function deriveTagsAndSummary(
  club: string,
  allTime: ClubProfileMetrics,
  recent: ClubProfileMetrics
): { tags: string[]; strengths: string[]; weaknesses: string[]; summary: string } {
  const tags: string[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (allTime.homeRecord.sample >= 3 && allTime.homeRecord.pct != null) {
    if (allTime.homeRecord.pct >= 65) {
      tags.push("Strong at home");
      strengths.push(`Home picks hit ${allTime.homeRecord.pct}% (${allTime.homeRecord.sample} picks)`);
    } else if (allTime.homeRecord.pct <= 40) {
      tags.push("Weak at home");
      weaknesses.push(`Home picks only ${allTime.homeRecord.pct}% (${allTime.homeRecord.sample} picks)`);
    }
  }

  if (allTime.awayRecord.sample >= 3 && allTime.awayRecord.pct != null) {
    if (allTime.awayRecord.pct >= 65) {
      tags.push("Strong away");
      strengths.push(`Away picks hit ${allTime.awayRecord.pct}% (${allTime.awayRecord.sample} picks)`);
    } else if (allTime.awayRecord.pct <= 40) {
      tags.push("Poor away");
      weaknesses.push(`Away picks only ${allTime.awayRecord.pct}% (${allTime.awayRecord.sample} picks)`);
    }
  }

  if (allTime.btts.sample >= 4 && allTime.btts.pct != null) {
    if (allTime.btts.pct >= 65) {
      tags.push("Reliable BTTS reads");
      strengths.push(`BTTS accuracy ${allTime.btts.pct}% (${allTime.btts.sample} picks)`);
    } else if (allTime.btts.pct <= 40) {
      tags.push("BTTS predictions often miss");
      weaknesses.push(`BTTS accuracy ${allTime.btts.pct}% (${allTime.btts.sample} picks)`);
    }
  }

  if (allTime.overUnderGoals.sample >= 4 && allTime.overUnderGoals.pct != null) {
    if (allTime.overUnderGoals.pct >= 65) tags.push("Strong on goals O/U");
    if (allTime.overUnderGoals.pct <= 40) tags.push("Goals O/U often wrong");
  }

  if (allTime.numericLines.corners.sample >= 4 && allTime.numericLines.corners.pct != null) {
    if (allTime.numericLines.corners.pct >= 65) tags.push("Strong on corners");
    if (allTime.numericLines.corners.pct <= 40) tags.push("Weak on corners prediction");
  }

  if (allTime.highRisk.sample >= 3 && allTime.highRisk.pct != null) {
    if (allTime.highRisk.pct <= 35) {
      tags.push("High-risk picks unreliable");
      weaknesses.push(`Odds >2.60 hit only ${allTime.highRisk.pct}% (${allTime.highRisk.sample} picks)`);
    } else if (allTime.highRisk.pct >= 60) {
      strengths.push(`High-risk picks hit ${allTime.highRisk.pct}% (${allTime.highRisk.sample} picks)`);
    }
  }

  for (const band of allTime.bttsByOddsRange) {
    if (band.sample >= 4 && band.pct != null && band.pct >= 70) {
      tags.push(`Overperforms at odds ${band.range}`);
    }
  }

  const recentNote =
    recent.homeRecord.sample >= 2 && recent.homeRecord.pct != null
      ? ` Recent home form ${recent.homeRecord.pct}%.`
      : "";

  const summary =
    tags.length > 0
      ? `${club}: ${tags.slice(0, 4).join(", ")}.${recentNote}`
      : `${club}: Building profile — ${allTime.homeRecord.sample + allTime.awayRecord.sample} scored picks so far.${recentNote}`;

  return { tags, strengths, weaknesses, summary };
}

function rowsToEvents(rows: ScoredRow[], weight: number): ClubPickEvent[] {
  const events: ClubPickEvent[] = [];
  for (const row of rows) {
    const matchKey = `${row.date}::${row.batchId}::${row.homeTeam}::${row.awayTeam}`;
    for (const club of [row.homeTeam, row.awayTeam]) {
      const venue = club === row.homeTeam ? "home" : "away";
      const opponent = venue === "home" ? row.awayTeam : row.homeTeam;
      events.push({
        batchId: row.batchId,
        date: row.date,
        league: row.league,
        club,
        opponent,
        venue,
        market: row.market,
        prediction: row.prediction,
        line: row.line,
        odds: row.odds,
        result: row.result,
        weight,
        matchKey,
      });
    }
  }
  return events;
}

function buildMetricsFromEvents(events: ClubPickEvent[]): ClubProfileMetrics {
  const metrics = emptyMetrics();
  for (const e of events) applyEvent(metrics, e);
  metrics.streaks = computeStreaks(events);
  return finalizeMetrics(metrics);
}

function recentMatchesForClub(events: ClubPickEvent[]): ClubRecentMatch[] {
  const byMatch = new Map<string, ClubPickEvent[]>();
  for (const e of events) {
    const key = `${e.matchKey}::${e.club}`;
    const list = byMatch.get(key) ?? [];
    list.push(e);
    byMatch.set(key, list);
  }

  const matches: ClubRecentMatch[] = [];
  for (const group of byMatch.values()) {
    const first = group[0]!;
    let correct = 0;
    let wrong = 0;
    for (const e of group) {
      if (e.result === "correct") correct++;
      if (e.result === "wrong") wrong++;
    }
    const sample = correct + wrong;
    matches.push({
      batchId: first.batchId,
      date: first.date,
      opponent: first.opponent,
      venue: first.venue,
      hitRatePct: sample > 0 ? Math.round((correct / sample) * 100) : null,
      picksScored: sample,
    });
  }

  return matches
    .sort((a, b) => `${b.date}${b.batchId}`.localeCompare(`${a.date}${a.batchId}`))
    .slice(0, RECENT_MATCHES_LIMIT);
}

function uniqueMatchKeys(events: ClubPickEvent[]): string[] {
  return [...new Set(events.map((e) => e.matchKey))].sort((a, b) => b.localeCompare(a));
}

export function recomputeClubProfiles(batches: PredictionBatch[]): ClubProfilesStore {
  const allRows = flattenScoredRows(batches).filter(
    (r) => r.result === "correct" || r.result === "wrong" || r.result === "push"
  );

  const allEvents = rowsToEvents(allRows, 1);
  const recentMatchKeys = new Set(uniqueMatchKeys(allEvents).slice(0, RECENT_WEIGHT_MATCHES));
  const weightedEvents = [
    ...allEvents,
    ...allEvents
      .filter((e) => recentMatchKeys.has(e.matchKey))
      .map((e) => ({ ...e, weight: RECENT_WEIGHT_FACTOR - 1 })),
  ];

  const clubs = new Map<string, { league: string; club: string }>();
  for (const e of allEvents) {
    clubs.set(clubProfileId(e.league, e.club), { league: e.league, club: e.club });
  }

  const profiles: Record<string, ClubProfile> = {};
  for (const [id, { league, club }] of clubs) {
    const clubAll = allEvents.filter((e) => e.league === league && e.club === club);
    const recentKeys = new Set(uniqueMatchKeys(clubAll).slice(0, RECENT_MATCHES_LIMIT));
    const clubRecent = clubAll.filter((e) => recentKeys.has(e.matchKey));
    const clubWeighted = weightedEvents.filter((e) => e.league === league && e.club === club);

    const allTime = buildMetricsFromEvents(clubAll);
    const recentOnly = buildMetricsFromEvents(clubRecent);
    const weighted = buildMetricsFromEvents(clubWeighted);
    const matchCount = uniqueMatchKeys(clubAll).length;
    const { tags, strengths, weaknesses, summary } = deriveTagsAndSummary(club, allTime, recentOnly);

    profiles[id] = {
      id,
      clubName: club,
      league,
      lastUpdated: new Date().toISOString(),
      version: CLUB_PROFILE_VERSION,
      totalMatches: matchCount,
      metrics: allTime,
      recentMetrics: recentOnly,
      weightedMetrics: weighted,
      strengths,
      weaknesses,
      tags,
      summary,
      recentMatches: recentMatchesForClub(clubAll),
    };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    profiles,
  };
}

export function getClubProfile(
  store: ClubProfilesStore | null | undefined,
  league: string,
  clubName: string
): ClubProfile | null {
  if (!store) return null;
  return store.profiles[clubProfileId(league, clubName)] ?? null;
}

export function listClubProfiles(store: ClubProfilesStore | null | undefined): ClubProfile[] {
  if (!store) return [];
  return Object.values(store.profiles).sort((a, b) =>
    `${a.league}${a.clubName}`.localeCompare(`${b.league}${b.clubName}`)
  );
}
