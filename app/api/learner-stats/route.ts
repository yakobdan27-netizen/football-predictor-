import { NextResponse } from "next/server";
import { loadLearnerStatsStore } from "@/lib/prediction-log/learner-stats-store";
import {
  countAiLearnerMarketRules,
  loadLearnerMarketRules,
} from "@/lib/prediction-log/learner-market-rules";
import { countAiLearnerPickOutcomes } from "@/lib/prediction-log/persist-weekend-learner-db";
import { countMarketReliability, loadMarketReliability } from "@/lib/prediction-log/learner-market-reliability";
import { countWeekendMarketResultsByFamily } from "@/lib/prediction-log/weekend-market-results";

export async function GET() {
  try {
    const [stats, marketRules, outcomeCount, ruleCount, marketResultRowsByFamily, marketReliabilityCount, topTeamMarkets] =
      await Promise.all([
      loadLearnerStatsStore(),
      loadLearnerMarketRules().catch(() => []),
      countAiLearnerPickOutcomes().catch(() => 0),
      countAiLearnerMarketRules().catch(() => 0),
      countWeekendMarketResultsByFamily().catch(() => ({
        win: 0,
        halfGoal: 0,
        corner: 0,
        combo: 0,
        bttsHalves: 0,
        drawHalf: 0,
        totalGoals: 0,
        stats: 0,
      })),
      countMarketReliability().catch(() => 0),
      loadMarketReliability().catch(() => []),
    ]);

    return NextResponse.json({
      stats,
      marketRules,
      marketRulesCount: ruleCount,
      weekendOutcomeCount: outcomeCount,
      marketResultRowsByFamily,
      marketReliabilityCount,
      topTeamMarkets: topTeamMarkets
        .filter((e) => e.winRate >= 65)
        .slice(0, 10),
      topRules: marketRules.slice(0, 10),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load learner stats";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
