/**
 * Cold-start seed season weights — use 0.8^seasons_ago (same as hist),
 * not linear 1..5. Seeds remain cold-start only; hist is the primary path.
 */
import { HIST_SEASON_DECAY_BASE } from "@/lib/hist/seasons";

/** Available static seed season labels (newest last). */
export const SEED_SEASON_ORDER = [
  "2021/22",
  "2022/23",
  "2023/24",
  "2024/25",
  "2025/26",
] as const;

export type SeedSeasonLabel = (typeof SEED_SEASON_ORDER)[number];

/** seasons_ago: 2025/26 → 0, 2024/25 → 1, … */
export function seedSeasonAgo(season: string): number {
  const idx = SEED_SEASON_ORDER.indexOf(season as SeedSeasonLabel);
  if (idx < 0) return SEED_SEASON_ORDER.length;
  return SEED_SEASON_ORDER.length - 1 - idx;
}

export function seedSeasonWeightRaw(season: string): number {
  return Math.pow(HIST_SEASON_DECAY_BASE, seedSeasonAgo(season));
}

/** Normalized weights for a set of season labels (Σ = 1). */
export function normalizedSeedWeights(
  seasons: string[]
): Record<string, number> {
  const raw = seasons.map((s) => seedSeasonWeightRaw(s));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = {};
  seasons.forEach((s, i) => {
    out[s] = raw[i]! / sum;
  });
  return out;
}
