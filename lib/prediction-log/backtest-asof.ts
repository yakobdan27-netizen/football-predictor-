/**
 * As-of / no-lookahead club + analysis state for reco walk-forward backtests.
 * Only history with date < T is visible when predicting match at T.
 */

import { applyCapacity } from "./club-capacity";
import { applyBayesianFromMatch } from "./bayesian-update";
import { recomputeAnalysis } from "./analysis";
import { buildCalibratorFromBatches } from "./global-calibration";
import { computeLeagueBaselines, type LeagueBaselinesStore } from "./league-baselines";
import { deriveActualsFromFacts } from "./grade-from-facts";
import { ftResult } from "./goal-result-sync";
import {
  buildIndexEntry,
  emptyClubIndex,
  normalizeClubName,
  slugifyClubName,
  upsertClubIndexEntry,
} from "./club-index";
import {
  HISTORY_TYPE_KEYS,
  createClubRecord,
  type ClubHistories,
  type ClubIndex,
  type ClubRecord,
  type HistoryEntry,
  type HistoryTypeKey,
} from "./club-record-types";
import type { TeamsQualityStore } from "./teams-quality-types";
import type {
  AnalysisHistory,
  LogMatch,
  PredictionBatch,
  TeamSideStats,
} from "./types";
import type { BinCalibrator } from "@/lib/predictor/calibration";
import type { RecommendationContext } from "./recommendation-context";
import { flattenScoredRows } from "./analysis";

export function isStrictlyBefore(date: string, asOfExclusive: string): boolean {
  return date < asOfExclusive;
}

export function filterEntriesAsOf(
  entries: HistoryEntry[],
  asOfExclusive: string
): HistoryEntry[] {
  return entries.filter(
    (e) => !e.superseded && isStrictlyBefore(e.date, asOfExclusive)
  );
}

/** Filter a club record to histories strictly before asOfExclusive; recompute capacity. */
export function clubRecordAsOf(
  record: ClubRecord,
  asOfExclusive: string,
  leagueBaselines: LeagueBaselinesStore | null = null,
  teamsQuality: TeamsQualityStore | null = null
): ClubRecord {
  const histories = Object.fromEntries(
    HISTORY_TYPE_KEYS.map((k) => [
      k,
      filterEntriesAsOf(record.histories[k] ?? [], asOfExclusive),
    ])
  ) as ClubHistories;

  const recentLineups = (record.recentLineups ?? []).filter((l) =>
    isStrictlyBefore(l.date, asOfExclusive)
  );

  // Drop live bayesian posteriors — they encode full-history lookahead.
  const trimmed: ClubRecord = {
    ...record,
    histories,
    recentLineups,
    bayesianMarkets: undefined,
    capacity: record.capacity,
    statMetadata: undefined,
  };
  return applyCapacity(trimmed, leagueBaselines, teamsQuality);
}

export function batchesStrictlyBefore(
  batches: PredictionBatch[],
  asOfExclusive: string
): PredictionBatch[] {
  return batches.filter((b) => isStrictlyBefore(b.date, asOfExclusive));
}

export function enrichMatchActuals(match: LogMatch): LogMatch {
  const derived = deriveActualsFromFacts(match);
  return {
    ...match,
    actualResults: { ...derived, ...match.actualResults },
  };
}

export function extractFtGoals(
  match: LogMatch
): { hg: number; ag: number } | null {
  const enriched = enrichMatchActuals(match);
  const hg =
    enriched.teamStats?.home?.goals ??
    (typeof enriched.actualResults.home_goals_ou?.actual === "number"
      ? enriched.actualResults.home_goals_ou.actual
      : null);
  const ag =
    enriched.teamStats?.away?.goals ??
    (typeof enriched.actualResults.away_goals_ou?.actual === "number"
      ? enriched.actualResults.away_goals_ou.actual
      : null);
  if (hg == null || ag == null || !Number.isFinite(hg) || !Number.isFinite(ag)) {
    return null;
  }
  return { hg, ag };
}

function newEntryId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function appendEntry(
  record: ClubRecord,
  type: HistoryTypeKey,
  entry: Omit<HistoryEntry, "id">
): ClubRecord {
  const list = [...record.histories[type], { ...entry, id: newEntryId() }];
  return {
    ...record,
    histories: { ...record.histories, [type]: list },
  };
}

function appendSideStats(
  record: ClubRecord,
  venue: "home" | "away",
  stats: TeamSideStats | undefined,
  meta: {
    date: string;
    batchId: string;
    matchId: string;
    opponentId: string;
    opponentName: string;
  }
): ClubRecord {
  if (!stats) return record;
  let updated = record;
  const fields: Array<[keyof TeamSideStats, HistoryTypeKey]> = [
    ["yellowCards", "yellowCards"],
    ["redCards", "redCards"],
    ["fouls", "fouls"],
    ["possession", "possession"],
    ["totalShots", "totalShots"],
    ["shotsOnTarget", "shotsOnTarget"],
    ["corners", "corners"],
    ["offsides", "offsides"],
  ];
  for (const [field, type] of fields) {
    const val = stats[field];
    if (val == null || typeof val !== "number" || !Number.isFinite(val)) continue;
    updated = appendEntry(updated, type, {
      date: meta.date,
      batchId: meta.batchId,
      matchId: meta.matchId,
      opponentId: meta.opponentId,
      opponentName: meta.opponentName,
      venue,
      predicted: val,
      actual: val,
      result: "hit",
    });
  }
  return updated;
}

/**
 * Append FT result facts to both clubs (histories + bayesian + capacity).
 * Call only AFTER predicting the match (walk-forward).
 */
export function applyMatchResultToClubs(
  home: ClubRecord,
  away: ClubRecord,
  match: LogMatch,
  meta: { batchId: string; date: string },
  leagueBaselines: LeagueBaselinesStore | null = null,
  teamsQuality: TeamsQualityStore | null = null
): { home: ClubRecord; away: ClubRecord } {
  const enriched = enrichMatchActuals(match);
  const goals = extractFtGoals(enriched);
  if (!goals) return { home, away };

  const { hg, ag } = goals;
  const result = ftResult(hg, ag);
  const btts = hg > 0 && ag > 0 ? "yes" : "no";

  let homeUpdated = home;
  let awayUpdated = away;

  homeUpdated = appendEntry(homeUpdated, "goalsScored", {
    date: meta.date,
    batchId: meta.batchId,
    matchId: enriched.id,
    opponentId: away.clubId,
    opponentName: away.clubName,
    venue: "home",
    predicted: hg,
    actual: hg,
    result: "hit",
  });
  homeUpdated = appendEntry(homeUpdated, "goalsConceded", {
    date: meta.date,
    batchId: meta.batchId,
    matchId: enriched.id,
    opponentId: away.clubId,
    opponentName: away.clubName,
    venue: "home",
    predicted: ag,
    actual: ag,
    result: "hit",
  });
  awayUpdated = appendEntry(awayUpdated, "goalsScored", {
    date: meta.date,
    batchId: meta.batchId,
    matchId: enriched.id,
    opponentId: home.clubId,
    opponentName: home.clubName,
    venue: "away",
    predicted: ag,
    actual: ag,
    result: "hit",
  });
  awayUpdated = appendEntry(awayUpdated, "goalsConceded", {
    date: meta.date,
    batchId: meta.batchId,
    matchId: enriched.id,
    opponentId: home.clubId,
    opponentName: home.clubName,
    venue: "away",
    predicted: hg,
    actual: hg,
    result: "hit",
  });

  const homeWl = result === "home" ? "win" : result === "draw" ? "draw" : "lose";
  const awayWl = result === "away" ? "win" : result === "draw" ? "draw" : "lose";
  homeUpdated = appendEntry(homeUpdated, "winLose", {
    date: meta.date,
    batchId: meta.batchId,
    matchId: enriched.id,
    opponentId: away.clubId,
    opponentName: away.clubName,
    venue: "home",
    predicted: homeWl,
    actual: homeWl,
    result: "hit",
  });
  awayUpdated = appendEntry(awayUpdated, "winLose", {
    date: meta.date,
    batchId: meta.batchId,
    matchId: enriched.id,
    opponentId: home.clubId,
    opponentName: home.clubName,
    venue: "away",
    predicted: awayWl,
    actual: awayWl,
    result: "hit",
  });

  homeUpdated = appendEntry(homeUpdated, "bothTeamsScore", {
    date: meta.date,
    batchId: meta.batchId,
    matchId: enriched.id,
    opponentId: away.clubId,
    opponentName: away.clubName,
    venue: "home",
    predicted: btts,
    actual: btts,
    result: "hit",
  });
  awayUpdated = appendEntry(awayUpdated, "bothTeamsScore", {
    date: meta.date,
    batchId: meta.batchId,
    matchId: enriched.id,
    opponentId: home.clubId,
    opponentName: home.clubName,
    venue: "away",
    predicted: btts,
    actual: btts,
    result: "hit",
  });

  homeUpdated = appendSideStats(homeUpdated, "home", enriched.teamStats?.home, {
    date: meta.date,
    batchId: meta.batchId,
    matchId: enriched.id,
    opponentId: away.clubId,
    opponentName: away.clubName,
  });
  awayUpdated = appendSideStats(awayUpdated, "away", enriched.teamStats?.away, {
    date: meta.date,
    batchId: meta.batchId,
    matchId: enriched.id,
    opponentId: home.clubId,
    opponentName: home.clubName,
  });

  const forBayes: LogMatch = {
    ...enriched,
    actualResults: {
      ...enriched.actualResults,
      "1x2": { actual: result },
      btts: { actual: btts },
      home_goals_ou: { actual: hg },
      away_goals_ou: { actual: ag },
    },
  };

  homeUpdated = applyBayesianFromMatch(
    homeUpdated,
    forBayes,
    "home",
    teamsQuality,
    leagueBaselines
  );
  awayUpdated = applyBayesianFromMatch(
    awayUpdated,
    forBayes,
    "away",
    teamsQuality,
    leagueBaselines
  );

  homeUpdated = applyCapacity(homeUpdated, leagueBaselines, teamsQuality);
  awayUpdated = applyCapacity(awayUpdated, leagueBaselines, teamsQuality);

  return { home: homeUpdated, away: awayUpdated };
}

export interface AsOfClubRegistry {
  clubs: Map<string, ClubRecord>;
  nameKeyToId: Map<string, string>;
  index: ClubIndex;
}

function nameKey(league: string, clubName: string): string {
  return `${league}::${normalizeClubName(clubName)}`;
}

export function createAsOfRegistry(): AsOfClubRegistry {
  return {
    clubs: new Map(),
    nameKeyToId: new Map(),
    index: emptyClubIndex(),
  };
}

export function resolveAsOfClub(
  registry: AsOfClubRegistry,
  clubName: string,
  league: string,
  preferredId?: string
): ClubRecord {
  const key = nameKey(league, clubName);
  let id = preferredId && registry.clubs.has(preferredId)
    ? preferredId
    : registry.nameKeyToId.get(key);

  if (!id) {
    id = preferredId ?? `bt_${slugifyClubName(clubName)}_${registry.nameKeyToId.size + 1}`;
    registry.nameKeyToId.set(key, id);
  } else if (!registry.nameKeyToId.has(key)) {
    registry.nameKeyToId.set(key, id);
  }

  let record = registry.clubs.get(id);
  if (!record) {
    record = createClubRecord(id, clubName, league);
    registry.clubs.set(id, record);
    registry.index = upsertClubIndexEntry(registry.index, buildIndexEntry(record));
  }
  return record;
}

export function clubRecordsMap(registry: AsOfClubRegistry): Record<string, ClubRecord> {
  const out: Record<string, ClubRecord> = {};
  for (const [id, rec] of registry.clubs) out[id] = rec;
  return out;
}

export function rebuildClubsMapAsOf(
  source: Record<string, ClubRecord>,
  asOfExclusive: string,
  leagueBaselines: LeagueBaselinesStore | null = null,
  teamsQuality: TeamsQualityStore | null = null
): Record<string, ClubRecord> {
  const out: Record<string, ClubRecord> = {};
  for (const [id, rec] of Object.entries(source)) {
    out[id] = clubRecordAsOf(rec, asOfExclusive, leagueBaselines, teamsQuality);
  }
  return out;
}

export function buildAsOfAnalysis(batchesBefore: PredictionBatch[]): AnalysisHistory {
  return recomputeAnalysis(batchesBefore);
}

export function buildAsOfRecommendationContext(opts: {
  league: string;
  batchesBefore: PredictionBatch[];
  clubRecords: Record<string, ClubRecord>;
  clubIndex: ClubIndex;
  leagueBaselines?: LeagueBaselinesStore | null;
  teamsQuality?: TeamsQualityStore | null;
  mlClassifier?: RecommendationContext["mlClassifier"];
}): RecommendationContext {
  const analysis = buildAsOfAnalysis(opts.batchesBefore);
  const binCalibrator: BinCalibrator | null = buildCalibratorFromBatches(
    opts.batchesBefore
  );
  const teamRows = flattenScoredRows(opts.batchesBefore);
  return {
    analysis,
    hasHistory: analysis.totalScored > 0,
    league: opts.league,
    teamRows,
    clubProfiles: null,
    clubRecords: opts.clubRecords,
    clubIndex: opts.clubIndex,
    leagueBaselines: opts.leagueBaselines ?? computeLeagueBaselines(opts.batchesBefore),
    mlClassifier: opts.mlClassifier ?? null,
    teamsQuality: opts.teamsQuality ?? null,
    leagueProfiles: null,
    leagueCharacterProfile: null,
    matchupCaches: {},
    allBatches: opts.batchesBefore,
    binCalibrator,
  };
}
