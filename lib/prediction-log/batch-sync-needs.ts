import { matchNeedsApiDetailFill } from "@/lib/football-api/map-fixture-to-match";
import { matchNeedsNamePairTrace } from "./result-trace";
import { batchNeedsResults } from "./scoring";
import type { PredictionBatch } from "./types";

/** Client-safe: whether a batch still needs API result sync or enrichment. */
export function batchNeedsAnyApiSync(batch: PredictionBatch): boolean {
  return (
    batchNeedsResults(batch) ||
    batch.matches.some(
      (m) => matchNeedsNamePairTrace(m) || matchNeedsApiDetailFill(m)
    )
  );
}
