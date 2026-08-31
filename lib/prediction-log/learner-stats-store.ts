import { recomputeLearnerStats, emptyLearnerStats } from "./ai-learner";
import { recomputeClubProfiles } from "./club-profiles";
import { loadAllBatches } from "./club-store";
import { getJson, setJson } from "./kv";
import { KV_KEYS } from "./kv-keys";
import {
  loadLearnerMarketRules,
  recomputeAndPersistMarketRules,
} from "./learner-market-rules";
import {
  loadMarketReliability,
  pickTopAndWeakTeamMarkets,
  recomputeAndPersistMarketReliability,
} from "./learner-market-reliability";
import {
  persistWeekendLearnerFromBatches,
} from "./persist-weekend-learner-db";
import { persistWeekendMarketFamilyResults } from "./weekend-market-results";
import type { LearnerStatsStore, MarketReliabilityEntry, PredictionBatch } from "./types";
import { getDb } from "@/lib/db";
import { aiLearnerStatsSnapshot } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const SNAPSHOT_ID = "global";

function mergeMarketRulesIntoStats(
  stats: LearnerStatsStore,
  rules: Awaited<ReturnType<typeof loadLearnerMarketRules>>
): LearnerStatsStore {
  if (rules.length === 0) return stats;
  return {
    ...stats,
    advice: {
      ...stats.advice,
      lossRecoveryRules: rules.map((r) => r.ruleText),
      lossRecoveryRuleEntries: rules,
    },
  };
}

function mergeMarketReliabilityIntoStats(
  stats: LearnerStatsStore,
  reliability: MarketReliabilityEntry[]
): LearnerStatsStore {
  if (reliability.length === 0) return stats;
  const { topTeamMarkets, weakTeamMarkets } = pickTopAndWeakTeamMarkets(reliability);
  return {
    ...stats,
    advice: {
      ...stats.advice,
      topTeamMarkets,
      weakTeamMarkets,
    },
  };
}

async function loadLearnerStatsFromDb(): Promise<LearnerStatsStore | null> {
  try {
    const db = await getDb();
    const rows = await db
      .select()
      .from(aiLearnerStatsSnapshot)
      .where(eq(aiLearnerStatsSnapshot.id, SNAPSHOT_ID))
      .limit(1);
    const row = rows[0];
    if (!row?.statsJson) return null;
    const parsed = JSON.parse(row.statsJson) as LearnerStatsStore;
    if (!parsed?.oddsRanges) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function persistLearnerStatsSnapshot(
  stats: LearnerStatsStore
): Promise<void> {
  try {
    const db = await getDb();
    const now = new Date();
    await db
      .insert(aiLearnerStatsSnapshot)
      .values({
        id: SNAPSHOT_ID,
        statsJson: JSON.stringify(stats),
        totalScoredPicks: stats.totalScoredPicks,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: aiLearnerStatsSnapshot.id,
        set: {
          statsJson: JSON.stringify(stats),
          totalScoredPicks: stats.totalScoredPicks,
          updatedAt: now,
        },
      });
  } catch {
    /* DB optional in dev */
  }
}

export async function loadLearnerStatsStore(): Promise<LearnerStatsStore> {
  const [rules, reliability] = await Promise.all([
    loadLearnerMarketRules().catch(() => [] as Awaited<
      ReturnType<typeof loadLearnerMarketRules>
    >),
    loadMarketReliability().catch(() => [] as MarketReliabilityEntry[]),
  ]);

  const fromDb = await loadLearnerStatsFromDb();
  if (fromDb) {
    return mergeMarketReliabilityIntoStats(
      mergeMarketRulesIntoStats(fromDb, rules),
      reliability
    );
  }

  const stored = await getJson<LearnerStatsStore>(KV_KEYS.learnerStats);
  if (!stored?.oddsRanges) {
    return mergeMarketReliabilityIntoStats(
      mergeMarketRulesIntoStats(emptyLearnerStats(), rules),
      reliability
    );
  }
  return mergeMarketReliabilityIntoStats(
    mergeMarketRulesIntoStats(stored, rules),
    reliability
  );
}

export async function saveLearnerStatsStore(stats: LearnerStatsStore): Promise<void> {
  await setJson(KV_KEYS.learnerStats, stats);
  await persistLearnerStatsSnapshot(stats);
}

/**
 * Recompute global learner stats from all batches and persist to KV + Postgres.
 * Club profiles are derived from the same batch set (server has no browser localStorage).
 */
export async function recomputeAndPersistLearnerStats(
  allBatches?: PredictionBatch[]
): Promise<LearnerStatsStore> {
  const batches = allBatches ?? (await loadAllBatches());
  await persistWeekendLearnerFromBatches(batches).catch(() => null);
  await persistWeekendMarketFamilyResults(batches).catch(() => null);
  await recomputeAndPersistMarketReliability().catch(() => null);
  await recomputeAndPersistMarketRules().catch(() => null);

  const clubProfiles = recomputeClubProfiles(batches);
  let stats = recomputeLearnerStats(batches, null, clubProfiles);

  const [rules, reliability] = await Promise.all([
    loadLearnerMarketRules().catch(() => [] as Awaited<
      ReturnType<typeof loadLearnerMarketRules>
    >),
    loadMarketReliability().catch(() => [] as MarketReliabilityEntry[]),
  ]);
  stats = mergeMarketReliabilityIntoStats(
    mergeMarketRulesIntoStats(stats, rules),
    reliability
  );

  await saveLearnerStatsStore(stats);
  return stats;
}
