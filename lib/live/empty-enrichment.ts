import { emptyMergedMatchStats } from "@/lib/stats-api/types";
import type { LiveBeSoccerEnrichment, LiveSourceConflictDto } from "./types";

export function emptyLiveBeSoccerEnrichment(
  besoccerMatchId: string | null = null,
  sourceConflicts: LiveSourceConflictDto[] = []
): LiveBeSoccerEnrichment {
  return {
    besoccerMatchId,
    ...emptyMergedMatchStats(),
    sourceConflicts,
  };
}
