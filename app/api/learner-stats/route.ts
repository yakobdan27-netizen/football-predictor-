import { NextResponse } from "next/server";
import { loadLearnerStatsStore } from "@/lib/prediction-log/learner-stats-store";
import {
  countAiLearnerMarketRules,
  loadLearnerMarketRules,
} from "@/lib/prediction-log/learner-market-rules";
import { countAiLearnerPickOutcomes } from "@/lib/prediction-log/persist-weekend-learner-db";

export async function GET() {
  try {
    const [stats, marketRules, outcomeCount, ruleCount] = await Promise.all([
      loadLearnerStatsStore(),
      loadLearnerMarketRules().catch(() => []),
      countAiLearnerPickOutcomes().catch(() => 0),
      countAiLearnerMarketRules().catch(() => 0),
    ]);

    return NextResponse.json({
      stats,
      marketRules,
      marketRulesCount: ruleCount,
      weekendOutcomeCount: outcomeCount,
      topRules: marketRules.slice(0, 10),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load learner stats";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
