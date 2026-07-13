import type { LogMarketKey, LogMatch, ScoreResult } from "./types";
import type { HistoryEntry, HistoryTypeKey } from "./club-record-types";

export interface MappedHistoryWrite {
  clubSide: "home" | "away";
  type: HistoryTypeKey;
  predicted: number | string;
  odds?: number;
}

function clubWinLosePick(
  market: LogMarketKey,
  prediction: string,
  side: "home" | "away"
): string {
  if (market === "1x2" || market === "ht_1x2") {
    if (side === "home") {
      if (prediction === "home") return "win";
      if (prediction === "draw") return "draw";
      return "lose";
    }
    if (prediction === "away") return "win";
    if (prediction === "draw") return "draw";
    return "lose";
  }
  if (market === "win_one_half") {
    if (side === "home" && prediction === "home") return "win";
    if (side === "away" && prediction === "away") return "win";
    return "lose";
  }
  return prediction;
}

export function mapMatchPredictionsToWrites(
  match: LogMatch,
  batchId: string,
  date: string,
  homeClubId: string,
  awayClubId: string,
  homeName: string,
  awayName: string
): { home: MappedHistoryWrite[]; away: MappedHistoryWrite[] } {
  const home: MappedHistoryWrite[] = [];
  const away: MappedHistoryWrite[] = [];

  for (const [key, pred] of Object.entries(match.predictions) as [
    LogMarketKey,
    { prediction: string; line?: number; odds?: number },
  ][]) {
    if (!pred) continue;
    const odds = pred.odds;

    switch (key) {
      case "1x2":
      case "ht_1x2":
      case "win_one_half":
        home.push({
          clubSide: "home",
          type: "winLose",
          predicted: clubWinLosePick(key, pred.prediction, "home"),
          odds,
        });
        away.push({
          clubSide: "away",
          type: "winLose",
          predicted: clubWinLosePick(key, pred.prediction, "away"),
          odds,
        });
        break;
      case "btts":
        home.push({ clubSide: "home", type: "bothTeamsScore", predicted: pred.prediction, odds });
        away.push({ clubSide: "away", type: "bothTeamsScore", predicted: pred.prediction, odds });
        break;
      case "home_goals_ou":
        home.push({
          clubSide: "home",
          type: "goalsScored",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        home.push({
          clubSide: "home",
          type: "overUnder",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        break;
      case "away_goals_ou":
        away.push({
          clubSide: "away",
          type: "goalsScored",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        away.push({
          clubSide: "away",
          type: "overUnder",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        break;
      case "sot_ou":
        home.push({
          clubSide: "home",
          type: "shotsOnTarget",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        away.push({
          clubSide: "away",
          type: "shotsOnTarget",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        break;
      case "home_sot_ou":
        home.push({
          clubSide: "home",
          type: "shotsOnTarget",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        break;
      case "away_sot_ou":
        away.push({
          clubSide: "away",
          type: "shotsOnTarget",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        break;
      case "shots_ou":
        home.push({
          clubSide: "home",
          type: "totalShots",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        away.push({
          clubSide: "away",
          type: "totalShots",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        break;
      case "home_shots_ou":
        home.push({
          clubSide: "home",
          type: "totalShots",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        break;
      case "away_shots_ou":
        away.push({
          clubSide: "away",
          type: "totalShots",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        break;
      case "corners_ou":
        home.push({
          clubSide: "home",
          type: "corners",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        away.push({
          clubSide: "away",
          type: "corners",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        break;
      case "offsides_ou":
        home.push({
          clubSide: "home",
          type: "offsides",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        away.push({
          clubSide: "away",
          type: "offsides",
          predicted: `${pred.prediction}${pred.line != null ? `@${pred.line}` : ""}`,
          odds,
        });
        break;
      default:
        break;
    }
  }

  return { home, away };
}

export function scoreToHistoryResult(
  scored: ScoreResult | undefined
): "hit" | "miss" | "pending" {
  if (scored === "correct") return "hit";
  if (scored === "wrong") return "miss";
  return "pending";
}

export function teamStatsWrites(
  match: LogMatch,
  homeClubId: string,
  awayClubId: string,
  awayName: string,
  homeName: string,
  batchId: string,
  date: string
): { home: MappedHistoryWrite[]; away: MappedHistoryWrite[] } {
  const home: MappedHistoryWrite[] = [];
  const away: MappedHistoryWrite[] = [];
  const ts = match.teamStats;
  if (!ts) return { home, away };

  if (ts.home.yellowCards != null) {
    home.push({ clubSide: "home", type: "yellowCards", predicted: ts.home.yellowCards });
  }
  if (ts.home.redCards != null) {
    home.push({ clubSide: "home", type: "redCards", predicted: ts.home.redCards });
  }
  if (ts.home.fouls != null) {
    home.push({ clubSide: "home", type: "fouls", predicted: ts.home.fouls });
  }
  if (ts.home.possession != null) {
    home.push({ clubSide: "home", type: "possession", predicted: ts.home.possession });
  }
  if (ts.home.totalShots != null) {
    home.push({ clubSide: "home", type: "totalShots", predicted: ts.home.totalShots });
  }
  if (ts.home.shotsOnTarget != null) {
    home.push({ clubSide: "home", type: "shotsOnTarget", predicted: ts.home.shotsOnTarget });
  }
  if (ts.home.corners != null) {
    home.push({ clubSide: "home", type: "corners", predicted: ts.home.corners });
  }
  if (ts.home.offsides != null) {
    home.push({ clubSide: "home", type: "offsides", predicted: ts.home.offsides });
  }
  if (ts.away.yellowCards != null) {
    away.push({ clubSide: "away", type: "yellowCards", predicted: ts.away.yellowCards });
  }
  if (ts.away.redCards != null) {
    away.push({ clubSide: "away", type: "redCards", predicted: ts.away.redCards });
  }
  if (ts.away.fouls != null) {
    away.push({ clubSide: "away", type: "fouls", predicted: ts.away.fouls });
  }
  if (ts.away.possession != null) {
    away.push({ clubSide: "away", type: "possession", predicted: ts.away.possession });
  }
  if (ts.away.totalShots != null) {
    away.push({ clubSide: "away", type: "totalShots", predicted: ts.away.totalShots });
  }
  if (ts.away.shotsOnTarget != null) {
    away.push({ clubSide: "away", type: "shotsOnTarget", predicted: ts.away.shotsOnTarget });
  }
  if (ts.away.corners != null) {
    away.push({ clubSide: "away", type: "corners", predicted: ts.away.corners });
  }
  if (ts.away.offsides != null) {
    away.push({ clubSide: "away", type: "offsides", predicted: ts.away.offsides });
  }

  void homeClubId;
  void awayClubId;
  void awayName;
  void homeName;
  void batchId;
  void date;
  return { home, away };
}

export function entryKey(
  batchId: string,
  matchId: string,
  type: HistoryTypeKey,
  venue: "home" | "away"
): string {
  return `${batchId}:${matchId}:${type}:${venue}`;
}

export function findActiveEntry(
  entries: HistoryEntry[],
  batchId: string,
  matchId: string,
  type: HistoryTypeKey,
  venue: "home" | "away"
): HistoryEntry | undefined {
  return entries
    .filter((e) => !e.superseded)
    .find(
      (e) =>
        e.batchId === batchId &&
        e.matchId === matchId &&
        e.venue === venue &&
        e.result !== undefined
    );
}

// Simpler find: last non-superseded for batch+match+type+venue
export function findPendingEntry(
  entries: HistoryEntry[],
  batchId: string,
  matchId: string,
  type: HistoryTypeKey
): HistoryEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (
      !e.superseded &&
      e.batchId === batchId &&
      e.matchId === matchId &&
      e.result === "pending"
    ) {
      return e;
    }
  }
  return undefined;
}
