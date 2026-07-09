import { impliedProbability, isValidOdds } from "./odds-bands";

export const VALUE_BET_MARGIN = 0.08;

export const SYSTEMATIC_ODDS_RULES: string[] = [
  "Implied probability = 1 ÷ decimal odds",
  "Only take a pick when your estimated probability exceeds implied probability by at least 8% (value bet)",
  "Prefer lower odds (higher implied probability) when your history shows poor results on high-odds bands",
  "Weight your last 20–30 scored picks more heavily than all-time data when judging patterns",
];

/** confidence is 0–100; odds is decimal 1.00–3.00 */
export function isValueBet(confidence: number, odds: number): boolean {
  if (!isValidOdds(odds)) return false;
  const estimated = confidence / 100;
  const implied = impliedProbability(odds);
  return estimated > implied + VALUE_BET_MARGIN;
}

export function valueGapPercent(confidence: number, odds: number): number | null {
  if (!isValidOdds(odds)) return null;
  return Math.round((confidence / 100 - impliedProbability(odds)) * 100);
}
