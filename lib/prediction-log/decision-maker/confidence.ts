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

  switch (band) {
    case "very_high":
      return Math.max(fromProb ?? 0, 88);
    case "high":
      return Math.max(fromProb ?? 0, 80);
    case "medium":
    case "moderate":
      return Math.max(fromProb ?? 0, 65);
    case "low":
      return fromProb ?? 45;
    default:
      return fromProb ?? 50;
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
