/**
 * Map Prediction Log ResultTraceState → core_result_trace.status.
 */
import type { ResultTraceState } from "@/lib/prediction-log/types";

export type CoreResultTraceStatus =
  | "pending"
  | "matched"
  | "filled"
  | "ambiguous"
  | "unresolved"
  | "not_final";

export function coreStatusFromLogState(
  state: ResultTraceState | undefined | null
): CoreResultTraceStatus {
  switch (state) {
    case "FILLED":
      return "filled";
    case "AMBIGUOUS":
    case "NEEDS_REVIEW":
      return "ambiguous";
    case "FOUND_NOT_FINAL":
      return "not_final";
    case "RETRY":
      return "unresolved";
    case "PENDING":
    default:
      return "pending";
  }
}

/** Valid transitions (append-friendly; filled is terminal). */
export function canTransitionCoreTraceStatus(
  from: CoreResultTraceStatus,
  to: CoreResultTraceStatus
): boolean {
  if (from === to) return true;
  if (from === "filled") return false;
  const order: CoreResultTraceStatus[] = [
    "pending",
    "unresolved",
    "not_final",
    "matched",
    "ambiguous",
    "filled",
  ];
  // Allow any non-filled → any (idempotent writers); block filled → other.
  return order.includes(to);
}
