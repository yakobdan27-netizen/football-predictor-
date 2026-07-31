/**
 * Bet-tracking constants. Isolated from prediction-log.
 */

export const BET_MARKET_TYPES = [
  "1X2",
  "OU_2_5",
  "BTTS",
  "DC",
  "1H_OU_0_5",
  "2H_OU_0_5",
] as const;

export type BetMarketType = (typeof BET_MARKET_TYPES)[number];

export const BET_SLIP_TYPES = ["SINGLE", "MULTI"] as const;
export type BetSlipType = (typeof BET_SLIP_TYPES)[number];

export const BET_SLIP_STATUSES = [
  "OPEN",
  "WON",
  "LOST",
  "VOID",
  "CASHOUT",
] as const;
export type BetSlipStatus = (typeof BET_SLIP_STATUSES)[number];

export const BET_SELECTION_RESULTS = [
  "PENDING",
  "WON",
  "LOST",
  "VOID",
] as const;
export type BetSelectionResult = (typeof BET_SELECTION_RESULTS)[number];

export const BET_MARKET_SOURCES = ["API", "MANUAL"] as const;
export type BetMarketSource = (typeof BET_MARKET_SOURCES)[number];

export const BET_FEED_TYPES = ["PRE", "LIVE"] as const;
export type BetFeedType = (typeof BET_FEED_TYPES)[number];

/** Prefer Bet365; fall back to first bookmaker in response. */
export const AF_PREFERRED_BOOKMAKER_ID = 8;

/** Quick-pick markets always shown on event cards. */
export const QUICK_MARKET_DEFS: Array<{
  marketType: BetMarketType;
  selectionLabel: string;
  display: string;
}> = [
  { marketType: "1X2", selectionLabel: "Home", display: "1" },
  { marketType: "1X2", selectionLabel: "Draw", display: "X" },
  { marketType: "1X2", selectionLabel: "Away", display: "2" },
  { marketType: "OU_2_5", selectionLabel: "Over", display: "O2.5" },
  { marketType: "BTTS", selectionLabel: "Yes", display: "BTTS" },
];

export const TRACKING_BANNER =
  "Tracking tool — records and settles slips against real match results. Odds/returns are for tracking only, not a guarantee.";
