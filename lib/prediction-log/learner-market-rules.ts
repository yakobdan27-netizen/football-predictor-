/**
 * Aggregated loss-recovery rules from weekend pick outcomes in Postgres.
 */
import { getDb } from "@/lib/db";
import {
  aiLearnerMarketRules,
  aiLearnerPickOutcomes,
  type NewAiLearnerMarketRule,
} from "@/lib/db/schema";
import { deriveActualsFromFacts } from "./grade-from-facts";
import { LOG_MARKETS, LOG_MARKET_MAP } from "./markets-config";
import { scoreMarket } from "./score-market";
import type {
  LogMarketKey,
  LogMatch,
  LossRecoveryRuleEntry,
  ScoreResult,
} from "./types";
import type { WeekendPickOutcomeExtract } from "./persist-weekend-learner-db";

export const MIN_RULE_SAMPLE = 3;

type RuleCounterKey = string;

function ruleKey(parts: {
  league: string;
  lostMarket: string;
  lostPrediction: string;
  lostLine: number | null;
  winMarket: string;
  winPrediction: string;
  winLine: number | null;
}): RuleCounterKey {
  return [
    parts.league,
    parts.lostMarket,
    parts.lostPrediction,
    parts.lostLine ?? "null",
    parts.winMarket,
    parts.winPrediction,
    parts.winLine ?? "null",
  ].join("|");
}

function lostKey(
  league: string,
  lostMarket: string,
  lostPrediction: string,
  lostLine: number | null
): RuleCounterKey {
  return ruleKey({
    league,
    lostMarket,
    lostPrediction,
    lostLine,
    winMarket: "",
    winPrediction: "",
    winLine: null,
  });
}

function matchFromOutcome(row: WeekendPickOutcomeExtract): LogMatch {
  return {
    id: row.matchId,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    league: row.league ?? "",
    matchDate: row.matchDate ?? undefined,
    apiFixtureId: row.providerFixtureId ?? undefined,
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: {
      home: {
        goals: row.ftHome ?? undefined,
        firstHalfGoals: row.htHome ?? undefined,
        corners: row.cornersHome ?? undefined,
      },
      away: {
        goals: row.ftAway ?? undefined,
        firstHalfGoals: row.htAway ?? undefined,
        corners: row.cornersAway ?? undefined,
      },
    },
  };
}

function numericWinningSide(
  actual: number,
  line: number
): "over" | "under" | "push" {
  if (actual > line) return "over";
  if (actual < line) return "under";
  return "push";
}

/** Hypothetical picks that would have won on this fixture. */
export function findWinningAlternatives(
  row: WeekendPickOutcomeExtract
): Array<{ market: LogMarketKey; prediction: string; line?: number }> {
  if (row.result !== "wrong") return [];
  if (row.marketKey === "combo") return [];

  const match = matchFromOutcome(row);
  const actuals = deriveActualsFromFacts(match);
  const winners: Array<{ market: LogMarketKey; prediction: string; line?: number }> = [];

  for (const def of LOG_MARKETS) {
    const key = def.key;
    const actualEntry = actuals[key];
    if (actualEntry?.actual == null) continue;

    const actual = actualEntry.actual;
    const lines =
      def.lineOptions?.length ? def.lineOptions : def.defaultLine != null ? [def.defaultLine] : [undefined];

    for (const line of lines) {
      let candidates: Array<{ prediction: string; line?: number }> = [];

      if (def.kind === "numeric" && line != null && typeof actual === "number") {
        const side = numericWinningSide(actual, line);
        if (side === "push") continue;
        candidates = [{ prediction: side, line }];
      } else if (def.kind === "categorical" && typeof actual === "string") {
        candidates = [{ prediction: actual, line: undefined }];
      } else if (
        (def.kind === "asian_handicap" || def.kind === "european_handicap") &&
        line != null &&
        typeof actual === "number"
      ) {
        for (const side of ["home", "away"] as const) {
          const r = scoreMarket(key, side, line, actual);
          if (r === "correct") candidates.push({ prediction: side, line });
        }
      }

      for (const cand of candidates) {
        const r = scoreMarket(key, cand.prediction, cand.line, actual);
        if (r !== "correct") continue;

        const sameLost =
          key === row.marketKey &&
          cand.prediction === row.prediction &&
          (cand.line ?? null) === (row.line ?? null);
        if (sameLost) continue;

        winners.push({ market: key, prediction: cand.prediction, line: cand.line });
      }
    }
  }

  const seen = new Set<string>();
  return winners.filter((w) => {
    const k = `${w.market}:${w.prediction}:${w.line ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

type RuleAccumulator = {
  league: string;
  lostMarket: string;
  lostPrediction: string;
  lostLine: number | null;
  winMarket: string;
  winPrediction: string;
  winLine: number | null;
  wins: number;
  losses: number;
};

function formatMarketLabel(market: string, prediction: string, line?: number | null): string {
  if (market === "combo") return prediction.replace(/_/g, " ");
  const label = LOG_MARKET_MAP[market as LogMarketKey]?.label ?? market;
  if (line != null) return `${label} ${prediction} ${line}`;
  return `${label} ${prediction}`;
}

function buildRuleText(acc: RuleAccumulator, winRate: number): string {
  const leaguePart = acc.league === "*" ? "across leagues" : `in ${acc.league}`;
  const lost = formatMarketLabel(acc.lostMarket, acc.lostPrediction, acc.lostLine);
  const win = formatMarketLabel(acc.winMarket, acc.winPrediction, acc.winLine);
  const total = acc.wins + acc.losses;
  return `When ${lost} loses ${leaguePart}, ${win} would have won ${winRate}% (${acc.wins}/${total} wrong picks).`;
}

/** Pure aggregation from outcome rows (testable without DB). */
export function aggregateLossRecoveryRules(
  outcomes: WeekendPickOutcomeExtract[]
): NewAiLearnerMarketRule[] {
  const wrongOutcomes = outcomes.filter((o) => o.result === "wrong");
  const totalWrongByLost = new Map<string, number>();
  const recoveryWins = new Map<string, RuleAccumulator & { sampleBase: number }>();

  for (const row of wrongOutcomes) {
    const league = row.league ?? "*";
    for (const lg of [league, "*"]) {
      const sig = lostKey(lg, row.marketKey, row.prediction, row.line ?? null);
      totalWrongByLost.set(sig, (totalWrongByLost.get(sig) ?? 0) + 1);
    }
  }

  for (const row of wrongOutcomes) {
    const alternatives = findWinningAlternatives(row);
    if (alternatives.length === 0) continue;
    const league = row.league ?? "*";

    for (const lg of [league, "*"]) {
      const base = totalWrongByLost.get(
        lostKey(lg, row.marketKey, row.prediction, row.line ?? null)
      ) ?? 0;
      for (const alt of alternatives) {
        const key = ruleKey({
          league: lg,
          lostMarket: row.marketKey,
          lostPrediction: row.prediction,
          lostLine: row.line ?? null,
          winMarket: alt.market,
          winPrediction: alt.prediction,
          winLine: alt.line ?? null,
        });
        let acc = recoveryWins.get(key);
        if (!acc) {
          acc = {
            league: lg,
            lostMarket: row.marketKey,
            lostPrediction: row.prediction,
            lostLine: row.line ?? null,
            winMarket: alt.market,
            winPrediction: alt.prediction,
            winLine: alt.line ?? null,
            wins: 0,
            losses: 0,
            sampleBase: base,
          };
          recoveryWins.set(key, acc);
        }
        acc.wins += 1;
      }
    }
  }

  const now = new Date();
  const rules: NewAiLearnerMarketRule[] = [];
  for (const acc of recoveryWins.values()) {
    const base =
      totalWrongByLost.get(
        lostKey(acc.league, acc.lostMarket, acc.lostPrediction, acc.lostLine)
      ) ?? acc.wins;
    if (base < MIN_RULE_SAMPLE) continue;
    const winRate = Math.round((acc.wins / base) * 100);
    rules.push({
      league: acc.league,
      lostMarket: acc.lostMarket,
      lostPrediction: acc.lostPrediction,
      lostLine: acc.lostLine,
      winMarket: acc.winMarket,
      winPrediction: acc.winPrediction,
      winLine: acc.winLine,
      wins: acc.wins,
      losses: base - acc.wins,
      sample: base,
      winRate,
      ruleText: buildRuleText({ ...acc, losses: base - acc.wins }, winRate),
      updatedAt: now,
    });
  }

  return rules.sort(
    (a, b) =>
      (b.winRate ?? 0) - (a.winRate ?? 0) || (b.sample ?? 0) - (a.sample ?? 0)
  );
}

export function outcomeRowFromDb(row: typeof aiLearnerPickOutcomes.$inferSelect): WeekendPickOutcomeExtract {
  return {
    batchId: row.batchId,
    matchId: row.matchId,
    providerFixtureId: row.providerFixtureId,
    weekendSurface: row.weekendSurface,
    league: row.league,
    homeTeam: row.homeTeam,
    awayTeam: row.awayTeam,
    matchDate: row.matchDate,
    marketKey: row.marketKey,
    prediction: row.prediction,
    line: row.line,
    confidence: row.confidence,
    result: row.result as "correct" | "wrong" | "push" | "void",
    actualValue: row.actualValue,
    lossReason: row.lossReason,
    ftHome: row.ftHome,
    ftAway: row.ftAway,
    htHome: row.htHome,
    htAway: row.htAway,
    cornersHome: row.cornersHome,
    cornersAway: row.cornersAway,
  };
}

export async function recomputeAndPersistMarketRules(): Promise<number> {
  const db = await getDb();
  const rows = await db.select().from(aiLearnerPickOutcomes);
  const extracts = rows.map(outcomeRowFromDb);
  const rules = aggregateLossRecoveryRules(extracts);

  await db.delete(aiLearnerMarketRules);

  if (rules.length === 0) return 0;

  await db.insert(aiLearnerMarketRules).values(rules);
  return rules.length;
}

export async function loadLearnerMarketRules(): Promise<LossRecoveryRuleEntry[]> {
  const db = await getDb();
  const rows = await db.select().from(aiLearnerMarketRules);

  return rows
    .map((r) => ({
      league: r.league,
      lostMarket: r.lostMarket as LogMarketKey,
      lostPrediction: r.lostPrediction,
      lostLine: r.lostLine ?? undefined,
      winMarket: r.winMarket as LogMarketKey,
      winPrediction: r.winPrediction,
      winLine: r.winLine ?? undefined,
      winRate: r.winRate ?? 0,
      sample: r.sample,
      ruleText: r.ruleText,
    }))
    .sort((a, b) => b.winRate - a.winRate || (b.sample ?? 0) - (a.sample ?? 0));
}

export function findMatchingLossRecoveryRule(
  league: string,
  marketKey: LogMarketKey | undefined,
  prediction: string,
  line: number | undefined,
  entries: LossRecoveryRuleEntry[] | undefined
): LossRecoveryRuleEntry | null {
  if (!entries?.length || !marketKey) return null;
  const normPred = prediction.trim().toLowerCase();
  let best: LossRecoveryRuleEntry | null = null;
  for (const e of entries) {
    if (e.lostMarket !== marketKey) continue;
    if (e.lostPrediction.trim().toLowerCase() !== normPred) continue;
    if ((e.lostLine ?? undefined) !== (line ?? undefined)) continue;
    if (e.league !== league && e.league !== "*") continue;
    if (!best || e.winRate > best.winRate || (e.winRate === best.winRate && e.sample > best.sample)) {
      best = e;
    }
  }
  return best;
}

export async function countAiLearnerMarketRules(): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ id: aiLearnerMarketRules.id }).from(aiLearnerMarketRules);
  return rows.length;
}
