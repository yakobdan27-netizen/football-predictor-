import { ODDS_BAND_LABELS } from "./odds-bands";
import { getRecommendations } from "./recommendations";
import { SYSTEMATIC_ODDS_RULES } from "./systematic-odds";
import type { AnalysisHistory, OddsBandId } from "./types";

function bandTip(
  bands: AnalysisHistory["oddsAnalysis"]["bands"],
  band: OddsBandId | null,
  kind: "target" | "avoid"
): string | null {
  if (!band) return null;
  const s = bands[band];
  const denom = s.wins + s.losses;
  if (denom < 3) return null;
  const label = ODDS_BAND_LABELS[band];
  if (s.lowSample) {
    return `${label}: only ${denom} picks — low sample, treat with caution.`;
  }
  if (kind === "target" && s.winRate != null && s.winRate >= 50) {
    return `Your win rate on ${label} is ${s.winRate}% (${denom} picks). Consider targeting these odds more.`;
  }
  if (kind === "avoid" && s.winRate != null && s.winRate < 45) {
    return `Avoid ${label} — only ${s.winRate}% win rate historically (${denom} picks).`;
  }
  return null;
}

export function getOddsRecommendations(
  analysis: AnalysisHistory | null,
  league?: string
): string[] {
  if (!analysis) {
    return ["Save batches with odds and results to unlock odds-based recommendations."];
  }

  const tips: string[] = [];
  const recent = analysis.oddsAnalysis.recentBands;
  const all = analysis.oddsAnalysis.bands;

  const recentWithSample = (Object.keys(recent) as OddsBandId[]).filter((b) => {
    const s = recent[b];
    return s.wins + s.losses >= 5 && !s.lowSample && s.winRate != null;
  });

  const source = recentWithSample.length > 0 ? recent : all;

  let bestBand: OddsBandId | null = null;
  let bestRate = -1;
  let worstBand: OddsBandId | null = null;
  let worstRate = 101;

  for (const band of Object.keys(source) as OddsBandId[]) {
    const s = source[band];
    const denom = s.wins + s.losses;
    if (denom < 3 || s.winRate == null) continue;
    if (s.winRate > bestRate) {
      bestRate = s.winRate;
      bestBand = band;
    }
    if (s.winRate < worstRate) {
      worstRate = s.winRate;
      worstBand = band;
    }
  }

  const targetTip = bandTip(source, bestBand, "target");
  if (targetTip) tips.push(targetTip);

  const avoidTip = bandTip(source, worstBand, "avoid");
  if (avoidTip && worstBand !== bestBand) tips.push(avoidTip);

  const highBand = source["2.51-3.00"];
  if (highBand.wins + highBand.losses >= 3 && highBand.winRate != null && highBand.winRate < 45) {
    tips.push(
      `High odds (2.51–3.00) have underperformed at ${highBand.winRate}% — prefer lower bands unless confidence clearly exceeds implied probability.`
    );
  }

  if (analysis.oddsAnalysis.bestValueBand) {
    const bv = all[analysis.oddsAnalysis.bestValueBand];
    if (!bv.lowSample && bv.valueScore != null) {
      tips.push(
        `Best value band: ${ODDS_BAND_LABELS[analysis.oddsAnalysis.bestValueBand]} (value score ${bv.valueScore}, ${bv.winRate}% win rate).`
      );
    }
  }

  tips.push(
    "On each pick: only bet when your confidence % exceeds implied probability (1÷odds) by at least 8%."
  );

  if (league) {
    const marketTips = getRecommendations(league, analysis).slice(0, 2);
    tips.push(...marketTips);
  }

  return tips.length > 0 ? tips.slice(0, 6) : ["Keep logging picks with odds to refine recommendations."];
}

export function getSystematicRules(): string[] {
  return [...SYSTEMATIC_ODDS_RULES];
}
