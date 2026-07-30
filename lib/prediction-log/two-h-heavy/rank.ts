import type { TwoHHeavyResult } from "./types";

/** Sort by p_2h_gt_1h desc, then confidence desc. */
export function compareTwoHHeavy(a: TwoHHeavyResult, b: TwoHHeavyResult): number {
  if (b.p_2h_gt_1h !== a.p_2h_gt_1h) return b.p_2h_gt_1h - a.p_2h_gt_1h;
  return b.confidence - a.confidence;
}

export function sortByTwoHHeavy<T extends { id: string }>(
  matches: T[],
  byId: Record<string, TwoHHeavyResult>
): T[] {
  return [...matches].sort((ma, mb) => {
    const a = byId[ma.id];
    const b = byId[mb.id];
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return compareTwoHHeavy(a, b);
  });
}

export function worstSource(
  a: "api" | "db" | "prior",
  b: "api" | "db" | "prior"
): "api" | "db" | "prior" {
  const rank = { prior: 0, db: 1, api: 2 } as const;
  return rank[a] <= rank[b] ? a : b;
}
