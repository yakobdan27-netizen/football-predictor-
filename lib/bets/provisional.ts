/**
 * Provisional live status pills — never writes final result.
 */
import type { BetMarketType } from "./constants";
import { evaluate, type FinalMatchState } from "./evaluate";

export type ProvisionalPill = "winning" | "losing" | "undecided";

export function provisionalStatus(
  marketType: string,
  label: string,
  live: {
    homeGoals: number | null;
    awayGoals: number | null;
    status: string;
    minute: number | null;
  }
): ProvisionalPill {
  const inPlay =
    /^(1H|HT|2H|ET|BT|P|LIVE|INT)$/i.test(live.status) ||
    (live.homeGoals != null && live.awayGoals != null);

  if (!inPlay || live.homeGoals == null || live.awayGoals == null) {
    return "undecided";
  }

  // Half markets stay undecided until we have half splits (not available live).
  if (
    marketType === "1H_OU_0_5" ||
    (marketType as BetMarketType) === "2H_OU_0_5"
  ) {
    return "undecided";
  }

  const state: FinalMatchState = {
    homeGoals: live.homeGoals,
    awayGoals: live.awayGoals,
    homeGoals1h: null,
    awayGoals1h: null,
    status: live.status,
  };
  const r = evaluate(marketType, label, state);
  if (r === "WON") return "winning";
  if (r === "LOST") return "losing";
  return "undecided";
}
