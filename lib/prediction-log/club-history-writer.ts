import type { PredictionBatch, LogMatch, LogMarketKey } from "./types";
import type { ClubRecord, HistoryEntry, HistoryTypeKey } from "./club-record-types";
import { resolveLeagueId } from "./league-registry";
import { applyCapacity } from "./club-capacity";
import { applyBayesianFromMatch } from "./bayesian-update";
import {
  mapMatchPredictionsToWrites,
  scoreToHistoryResult,
  type MappedHistoryWrite,
} from "./history-mapper";
import {
  findOrCreateClub,
  loadClubRecord,
  saveClubRecord,
} from "./club-store";
import { buildMatchupCache, saveMatchupCache } from "./matchup-cache";
import { matchLearningWeight } from "./match-learning";
import type { LeagueBaselinesStore } from "./league-baselines";
import type { TeamsQualityStore } from "./teams-quality-types";

export interface ClubHistoryWriteContext {
  leagueBaselines?: LeagueBaselinesStore | null;
  teamsQuality?: TeamsQualityStore | null;
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
  const list = [...record.histories[type]];
  // Supersede existing pending for same batch+match+type+venue
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (
      !e.superseded &&
      e.batchId === entry.batchId &&
      e.matchId === entry.matchId &&
      e.venue === entry.venue &&
      e.result === "pending"
    ) {
      list[i] = { ...e, superseded: true, editedAt: new Date().toISOString() };
    }
  }
  list.push({ ...entry, id: newEntryId() });
  return {
    ...record,
    histories: { ...record.histories, [type]: list },
  };
}

function applyWrites(
  record: ClubRecord,
  writes: MappedHistoryWrite[],
  ctx: {
    batchId: string;
    matchId: string;
    date: string;
    venue: "home" | "away";
    opponentId: string;
    opponentName: string;
    match: LogMatch;
  }
): ClubRecord {
  let updated = record;
  for (const w of writes) {
    const marketKeys = Object.keys(ctx.match.predictions) as LogMarketKey[];
    let scoredResult: "hit" | "miss" | "pending" = "pending";
    for (const mk of marketKeys) {
      const s = ctx.match.scored[mk];
      if (s === "correct" || s === "wrong") {
        scoredResult = scoreToHistoryResult(s);
        break;
      }
    }
    // Use type-specific scoring when possible
    const typeResult = resolveResultForType(ctx.match, w.type, ctx.venue);

    updated = appendEntry(updated, w.type, {
      date: ctx.date,
      batchId: ctx.batchId,
      matchId: ctx.matchId,
      opponentId: ctx.opponentId,
      opponentName: ctx.opponentName,
      venue: ctx.venue,
      predicted: w.predicted,
      actual: typeResult.actual,
      result: typeResult.result,
      odds: w.odds,
      sampleWeight: matchLearningWeight(ctx.match.teamStats),
    });
  }
  return updated;
}

function resolveResultForType(
  match: LogMatch,
  type: HistoryTypeKey,
  venue: "home" | "away"
): { result: "hit" | "miss" | "pending"; actual?: number | string } {
  const ts = match.teamStats?.[venue];

  if (type === "yellowCards" && ts?.yellowCards != null) {
    return { result: "hit", actual: ts.yellowCards };
  }
  if (type === "redCards" && ts?.redCards != null) {
    return { result: "hit", actual: ts.redCards };
  }
  if (type === "fouls" && ts?.fouls != null) {
    return { result: "hit", actual: ts.fouls };
  }
  if (type === "possession" && ts?.possession != null) {
    return { result: "hit", actual: ts.possession };
  }
  if (type === "totalShots" && ts?.totalShots != null) {
    const sideMarket: LogMarketKey = venue === "home" ? "home_shots_ou" : "away_shots_ou";
    const marketKey: LogMarketKey = match.predictions[sideMarket] ? sideMarket : "shots_ou";
    return teamStatMarketResult(match, ts.totalShots, marketKey);
  }
  if (type === "shotsOnTarget" && ts?.shotsOnTarget != null) {
    return teamStatMarketResult(match, ts.shotsOnTarget, "sot_ou");
  }
  if (type === "corners" && ts?.corners != null) {
    return teamStatMarketResult(match, ts.corners, "corners_ou");
  }
  if (type === "offsides" && ts?.offsides != null) {
    return teamStatMarketResult(match, ts.offsides, "offsides_ou");
  }

  const marketForType: Partial<Record<HistoryTypeKey, LogMarketKey>> = {
    winLose: "1x2",
    bothTeamsScore: "btts",
    shotsOnTarget: "sot_ou",
    totalShots: venue === "home"
      ? match.predictions.home_shots_ou
        ? "home_shots_ou"
        : "shots_ou"
      : match.predictions.away_shots_ou
        ? "away_shots_ou"
        : "shots_ou",
    corners: "corners_ou",
    offsides: "offsides_ou",
    goalsScored: venue === "home" ? "home_goals_ou" : "away_goals_ou",
    goalsConceded: venue === "home" ? "away_goals_ou" : "home_goals_ou",
    overUnder: venue === "home" ? "home_goals_ou" : "away_goals_ou",
  };

  const mk = marketForType[type];
  if (mk) {
    const scored = match.scored[mk];
    const actual = match.actualResults[mk]?.actual;
    if (scored === "correct") return { result: "hit", actual };
    if (scored === "wrong") return { result: "miss", actual };
    if (actual != null) return { result: "pending", actual };
  }

  return { result: "pending" };
}

function teamStatMarketResult(
  match: LogMatch,
  value: number,
  market: LogMarketKey
): { result: "hit" | "miss" | "pending"; actual: number } {
  if (match.predictions[market]) {
    const scored = match.scored[market];
    if (scored === "correct") return { result: "hit", actual: value };
    if (scored === "wrong") return { result: "miss", actual: value };
    return { result: "pending", actual: value };
  }
  return { result: "hit", actual: value };
}

export { resolveResultForType };

async function processMatch(
  batch: PredictionBatch,
  match: LogMatch,
  writeCtx: ClubHistoryWriteContext = {}
): Promise<LogMatch> {
  const homeRecord = await findOrCreateClub(match.homeTeam, batch.league);
  const awayRecord = await findOrCreateClub(match.awayTeam, batch.league);

  const { home: homeWrites, away: awayWrites } = mapMatchPredictionsToWrites(
    match,
    batch.id,
    batch.date,
    homeRecord.clubId,
    awayRecord.clubId,
    match.homeTeam,
    match.awayTeam
  );

  let homeUpdated = applyWrites(homeRecord, homeWrites, {
    batchId: batch.id,
    matchId: match.id,
    date: batch.date,
    venue: "home",
    opponentId: awayRecord.clubId,
    opponentName: match.awayTeam,
    match,
  });

  let awayUpdated = applyWrites(awayRecord, awayWrites, {
    batchId: batch.id,
    matchId: match.id,
    date: batch.date,
    venue: "away",
    opponentId: homeRecord.clubId,
    opponentName: match.homeTeam,
    match,
  });

  // Team stats histories
  if (match.teamStats) {
    const ts = match.teamStats;
    const sampleWeight = matchLearningWeight(ts);
    if (ts.home.yellowCards != null) {
      homeUpdated = appendEntry(homeUpdated, "yellowCards", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: awayRecord.clubId,
        opponentName: match.awayTeam,
        venue: "home",
        predicted: ts.home.yellowCards,
        actual: ts.home.yellowCards,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.home.redCards != null) {
      homeUpdated = appendEntry(homeUpdated, "redCards", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: awayRecord.clubId,
        opponentName: match.awayTeam,
        venue: "home",
        predicted: ts.home.redCards,
        actual: ts.home.redCards,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.home.fouls != null) {
      homeUpdated = appendEntry(homeUpdated, "fouls", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: awayRecord.clubId,
        opponentName: match.awayTeam,
        venue: "home",
        predicted: ts.home.fouls,
        actual: ts.home.fouls,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.home.possession != null) {
      homeUpdated = appendEntry(homeUpdated, "possession", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: awayRecord.clubId,
        opponentName: match.awayTeam,
        venue: "home",
        predicted: ts.home.possession,
        actual: ts.home.possession,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.home.totalShots != null) {
      homeUpdated = appendEntry(homeUpdated, "totalShots", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: awayRecord.clubId,
        opponentName: match.awayTeam,
        venue: "home",
        predicted: ts.home.totalShots,
        actual: ts.home.totalShots,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.home.shotsOnTarget != null) {
      homeUpdated = appendEntry(homeUpdated, "shotsOnTarget", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: awayRecord.clubId,
        opponentName: match.awayTeam,
        venue: "home",
        predicted: ts.home.shotsOnTarget,
        actual: ts.home.shotsOnTarget,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.home.corners != null) {
      homeUpdated = appendEntry(homeUpdated, "corners", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: awayRecord.clubId,
        opponentName: match.awayTeam,
        venue: "home",
        predicted: ts.home.corners,
        actual: ts.home.corners,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.home.offsides != null) {
      homeUpdated = appendEntry(homeUpdated, "offsides", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: awayRecord.clubId,
        opponentName: match.awayTeam,
        venue: "home",
        predicted: ts.home.offsides,
        actual: ts.home.offsides,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.away.yellowCards != null) {
      awayUpdated = appendEntry(awayUpdated, "yellowCards", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: homeRecord.clubId,
        opponentName: match.homeTeam,
        venue: "away",
        predicted: ts.away.yellowCards,
        actual: ts.away.yellowCards,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.away.redCards != null) {
      awayUpdated = appendEntry(awayUpdated, "redCards", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: homeRecord.clubId,
        opponentName: match.homeTeam,
        venue: "away",
        predicted: ts.away.redCards,
        actual: ts.away.redCards,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.away.fouls != null) {
      awayUpdated = appendEntry(awayUpdated, "fouls", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: homeRecord.clubId,
        opponentName: match.homeTeam,
        venue: "away",
        predicted: ts.away.fouls,
        actual: ts.away.fouls,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.away.possession != null) {
      awayUpdated = appendEntry(awayUpdated, "possession", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: homeRecord.clubId,
        opponentName: match.homeTeam,
        venue: "away",
        predicted: ts.away.possession,
        actual: ts.away.possession,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.away.totalShots != null) {
      awayUpdated = appendEntry(awayUpdated, "totalShots", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: homeRecord.clubId,
        opponentName: match.homeTeam,
        venue: "away",
        predicted: ts.away.totalShots,
        actual: ts.away.totalShots,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.away.shotsOnTarget != null) {
      awayUpdated = appendEntry(awayUpdated, "shotsOnTarget", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: homeRecord.clubId,
        opponentName: match.homeTeam,
        venue: "away",
        predicted: ts.away.shotsOnTarget,
        actual: ts.away.shotsOnTarget,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.away.corners != null) {
      awayUpdated = appendEntry(awayUpdated, "corners", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: homeRecord.clubId,
        opponentName: match.homeTeam,
        venue: "away",
        predicted: ts.away.corners,
        actual: ts.away.corners,
        result: "hit",
        sampleWeight,
      });
    }
    if (ts.away.offsides != null) {
      awayUpdated = appendEntry(awayUpdated, "offsides", {
        date: batch.date,
        batchId: batch.id,
        matchId: match.id,
        opponentId: homeRecord.clubId,
        opponentName: match.homeTeam,
        venue: "away",
        predicted: ts.away.offsides,
        actual: ts.away.offsides,
        result: "hit",
        sampleWeight,
      });
    }
  }

  homeUpdated = applyBayesianFromMatch(
    homeUpdated,
    match,
    "home",
    writeCtx.teamsQuality ?? null,
    writeCtx.leagueBaselines ?? null
  );
  awayUpdated = applyBayesianFromMatch(
    awayUpdated,
    match,
    "away",
    writeCtx.teamsQuality ?? null,
    writeCtx.leagueBaselines ?? null
  );

  homeUpdated = applyCapacity(
    homeUpdated,
    writeCtx.leagueBaselines ?? null,
    writeCtx.teamsQuality ?? null
  );
  awayUpdated = applyCapacity(
    awayUpdated,
    writeCtx.leagueBaselines ?? null,
    writeCtx.teamsQuality ?? null
  );

  const leagueId = batch.leagueId ?? resolveLeagueId(batch.league);
  if (homeUpdated.leagueId !== leagueId) homeUpdated = { ...homeUpdated, leagueId };
  if (awayUpdated.leagueId !== leagueId) awayUpdated = { ...awayUpdated, leagueId };

  await saveClubRecord(homeUpdated);
  await saveClubRecord(awayUpdated);

  const cache = buildMatchupCache(homeUpdated, awayUpdated);
  await saveMatchupCache(cache);

  return {
    ...match,
    homeClubId: homeRecord.clubId,
    awayClubId: awayRecord.clubId,
  };
}

export async function syncBatchToClubHistories(
  batch: PredictionBatch,
  writeCtx: ClubHistoryWriteContext = {}
): Promise<PredictionBatch> {
  const leagueId = batch.leagueId ?? resolveLeagueId(batch.league);
  const normalizedBatch = { ...batch, leagueId };
  const matches: LogMatch[] = [];
  for (const match of normalizedBatch.matches) {
    matches.push(await processMatch(normalizedBatch, match, writeCtx));
  }
  return { ...normalizedBatch, matches };
}

export async function loadClubRecordsByIds(
  ids: string[]
): Promise<Map<string, ClubRecord>> {
  const map = new Map<string, ClubRecord>();
  for (const id of ids) {
    const r = await loadClubRecord(id);
    if (r) map.set(id, r);
  }
  return map;
}
