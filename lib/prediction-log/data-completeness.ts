/** Club/league history warmth from sample size. */
export type DataCompletenessLevel = "low" | "warm" | "ready";

export function dataCompletenessLevel(sampleSize: number): DataCompletenessLevel {
  if (sampleSize < 5) return "low";
  if (sampleSize < 20) return "warm";
  return "ready";
}

export function dataCompletenessLabel(level: DataCompletenessLevel): string {
  if (level === "low") return "Low — thin history";
  if (level === "warm") return "Warming up";
  return "Ready";
}

export function dataCompletenessPct(sampleSize: number, readyAt = 20): number {
  return Math.min(100, Math.round((sampleSize / readyAt) * 100));
}
