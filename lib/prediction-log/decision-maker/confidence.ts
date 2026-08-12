/** Map qualitative bands / probabilities onto 0–100 for Decision Maker scoring. */

export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

export function bandToConfidence(
  band: string | null | undefined,
  topProbability?: number
): number {
  const fromProb =
    topProbability != null && Number.isFinite(topProbability)
      ? clampConfidence(topProbability <= 1 ? topProbability * 100 : topProbability)
      : null;

  // Prefer tangible probability; band is a quality label only — never inflate %.
  switch (band) {
    case "very_high":
      return fromProb ?? 88;
    case "high":
      return fromProb ?? 80;
    case "medium":
    case "moderate":
      return fromProb ?? 65;
    case "low":
      // Cap soft floors so seed/low never looks like a green 80%+ pick.
      return fromProb != null ? Math.min(fromProb, 55) : 40;
    default:
      return fromProb ?? 0;
  }
}

export function confidenceTone(
  confidence: number
): "green" | "yellow" | "orange" | "muted" {
  if (confidence >= 80) return "green";
  if (confidence >= 60) return "yellow";
  if (confidence >= 50) return "orange";
  return "muted";
}
