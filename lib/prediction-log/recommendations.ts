import { LOG_MARKET_MAP } from "./markets-config";
import type { AnalysisHistory, LogMarketKey } from "./types";

export function getRecommendations(
  league: string,
  analysis: AnalysisHistory | null
): string[] {
  if (!analysis || analysis.totalScored === 0) {
    return [
      "No scored history yet — save results on past batches to unlock personal recommendations.",
    ];
  }

  const tips: string[] = [];
  const leagueStats = analysis.leagueAccuracy[league];

  if (leagueStats) {
    for (const [key, stats] of Object.entries(leagueStats) as [
      LogMarketKey,
      { correct: number; wrong: number; pct: number | null },
    ][]) {
      const total = stats.correct + stats.wrong;
      if (total < 3 || stats.pct == null) continue;
      const label = LOG_MARKET_MAP[key]?.label ?? key;
      tips.push(
        `In ${league} your ${label} accuracy is ${stats.pct}% (${total} picks).`
      );
    }
  }

  for (const rank of analysis.topMarkets.slice(0, 2)) {
    tips.push(
      `Strongest edge: ${rank.label} — ${rank.pct}% (${rank.total} picks).`
    );
  }

  for (const rank of analysis.weakestMarkets.slice(0, 2)) {
    if (rank.pct < 50) {
      tips.push(`Consider avoiding ${rank.label} — only ${rank.pct}% historically.`);
    }
  }

  if (analysis.recentForm.pct != null && analysis.recentForm.correct + analysis.recentForm.wrong >= 5) {
    tips.push(
      `Recent form (last 20 scored picks): ${analysis.recentForm.pct}% hit rate.`
    );
  }

  if (analysis.highConfidenceAccuracy.pct != null) {
    const n = analysis.highConfidenceAccuracy.correct + analysis.highConfidenceAccuracy.wrong;
    if (n >= 3) {
      tips.push(
        `When confidence >70%, you hit ${analysis.highConfidenceAccuracy.pct}% (${n} picks).`
      );
    }
  }

  return tips.length > 0 ? tips.slice(0, 8) : ["Keep logging results to refine recommendations."];
}
