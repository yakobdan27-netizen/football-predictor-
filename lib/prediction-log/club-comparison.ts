import type { ClubRecord, HistoryTypeKey } from "./club-record-types";
import type { MatchupCache } from "./club-record-types";

export interface ComparisonResult {
  confidence: number;
  judgement: string;
  lowDataWarning: boolean;
  risky: boolean;
  homeEdge: number;
  awayEdge: number;
}

const MIN_SAMPLE = 3;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function compareClubs(
  clubA: ClubRecord,
  clubB: ClubRecord,
  venue: "home" | "away",
  type: HistoryTypeKey,
  matchup?: MatchupCache | null
): ComparisonResult {
  const capA = clubA.capacity;
  const capB = clubB.capacity;
  const lowData = capA.lowSample || capB.lowSample;

  let homeEdge = 0;
  let awayEdge = 0;
  let judgement = "";
  let risky = false;

  switch (type) {
    case "winLose": {
      const aRate = venue === "home" ? capA.homeWinRate : capA.awayWinRate;
      const bRate = venue === "home" ? capB.awayWinRate : capB.homeWinRate;
      homeEdge = aRate;
      awayEdge = bRate;
      const diff = aRate - bRate;
      judgement =
        diff >= 15
          ? `${clubA.clubName} has stronger ${venue} form (${aRate}% vs opponent ${bRate}%).`
          : diff <= -15
            ? `${clubB.clubName} looks stronger on this venue split.`
            : `Win rates are close (${aRate}% vs ${bRate}%).`;
      risky = Math.max(aRate, bRate) < 45;
      break;
    }
    case "shotsOnTarget": {
      homeEdge = capA.avgShotsOnTarget;
      awayEdge = capB.avgShotsOnTarget;
      judgement = `SOT attack ${capA.avgShotsOnTarget} vs opponent ${capB.avgShotsOnTarget}.`;
      risky = capA.avgShotsOnTarget < 3 && capB.avgShotsOnTarget < 3;
      break;
    }
    case "yellowCards":
    case "fouls": {
      const aVal = type === "yellowCards" ? capA.avgYellowCards : capA.avgFouls;
      const bVal = type === "yellowCards" ? capB.avgYellowCards : capB.avgFouls;
      homeEdge = aVal;
      awayEdge = bVal;
      judgement = `${type} tendency: ${clubA.clubName} ${aVal} vs ${clubB.clubName} ${bVal}.`;
      risky = false;
      break;
    }
    case "possession": {
      homeEdge = capA.avgPossession;
      awayEdge = capB.avgPossession;
      judgement = `Possession avg ${capA.avgPossession}% vs ${capB.avgPossession}%.`;
      risky = false;
      break;
    }
    default: {
      const accA = capA.predictionAccuracyByType[type] ?? capA.winRate;
      const accB = capB.predictionAccuracyByType[type] ?? capB.winRate;
      homeEdge = accA;
      awayEdge = accB;
      judgement = `Your ${type} accuracy: ${clubA.clubName} ${accA}% vs context ${accB}%.`;
      risky = accA < 40;
    }
  }

  if (matchup && matchup.meetings >= 2) {
    judgement += ` H2H: ${matchup.meetings} meetings.`;
  }

  const formBoost = (capA.recentForm - capB.recentForm) * 2;
  const samplePenalty = lowData ? -15 : 0;
  const edge = homeEdge - awayEdge + formBoost;
  const confidence = clamp(Math.round(50 + edge * 0.8 + samplePenalty), 5, 95);

  if (capA.sampleSize < MIN_SAMPLE || capB.sampleSize < MIN_SAMPLE) {
    risky = true;
  }

  return {
    confidence,
    judgement,
    lowDataWarning: lowData,
    risky,
    homeEdge,
    awayEdge,
  };
}

export function compareMatchup(
  clubA: ClubRecord,
  clubB: ClubRecord,
  venue: "home" | "away"
): ComparisonResult {
  const types: HistoryTypeKey[] = ["winLose", "shotsOnTarget", "goalsScored"];
  const results = types.map((t) => compareClubs(clubA, clubB, venue, t));
  const avgConf = Math.round(
    results.reduce((s, r) => s + r.confidence, 0) / results.length
  );
  const risky = results.some((r) => r.risky);
  const lowData = results.some((r) => r.lowDataWarning);
  return {
    confidence: avgConf,
    judgement: results.map((r) => r.judgement).join(" "),
    lowDataWarning: lowData,
    risky,
    homeEdge: results[0]?.homeEdge ?? 0,
    awayEdge: results[0]?.awayEdge ?? 0,
  };
}
