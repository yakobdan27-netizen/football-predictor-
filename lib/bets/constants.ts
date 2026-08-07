/**
 * Bet-tracking constants. Isolated from prediction-log.
 */

export const BET_MARKET_TYPES = [
  "1X2",
  "DC",
  "DNB",
  "OU_0_5",
  "OU_1_5",
  "OU_2_5",
  "OU_3_5",
  "OU_4_5",
  "BTTS",
  "1H_1X2",
  "1H_OU_0_5",
  "1H_OU_1_5",
  "2H_OU_0_5",
  "2H_OU_1_5",
  "HALF_MOST_GOALS",
  "RESULT_BTTS",
  "RESULT_OU_2_5",
] as const;

export type BetMarketType = (typeof BET_MARKET_TYPES)[number];

export type MarketCategoryId = "main" | "goals" | "halves" | "combos";

export type CatalogOutcome = {
  marketType: BetMarketType;
  selectionLabel: string;
  display: string;
};

export type MarketCategory = {
  id: MarketCategoryId;
  title: string;
  markets: Array<{
    marketType: BetMarketType;
    title: string;
    outcomes: CatalogOutcome[];
  }>;
};

function ouOutcomes(
  marketType: BetMarketType,
  line: string
): CatalogOutcome[] {
  return [
    {
      marketType,
      selectionLabel: "Over",
      display: `O${line}`,
    },
    {
      marketType,
      selectionLabel: "Under",
      display: `U${line}`,
    },
  ];
}

function hxOutcomes(marketType: BetMarketType): CatalogOutcome[] {
  return [
    { marketType, selectionLabel: "Home", display: "1" },
    { marketType, selectionLabel: "Draw", display: "X" },
    { marketType, selectionLabel: "Away", display: "2" },
  ];
}

/** Full coupon catalog — every outcome always shown (API or MANUAL). */
export const FULL_MARKET_CATALOG: MarketCategory[] = [
  {
    id: "main",
    title: "Main",
    markets: [
      {
        marketType: "1X2",
        title: "1X2",
        outcomes: hxOutcomes("1X2"),
      },
      {
        marketType: "DC",
        title: "Double Chance",
        outcomes: [
          { marketType: "DC", selectionLabel: "1X", display: "1X" },
          { marketType: "DC", selectionLabel: "12", display: "12" },
          { marketType: "DC", selectionLabel: "X2", display: "X2" },
        ],
      },
      {
        marketType: "DNB",
        title: "Draw No Bet",
        outcomes: [
          { marketType: "DNB", selectionLabel: "Home", display: "1" },
          { marketType: "DNB", selectionLabel: "Away", display: "2" },
        ],
      },
    ],
  },
  {
    id: "goals",
    title: "Goals",
    markets: [
      {
        marketType: "OU_0_5",
        title: "Over/Under 0.5",
        outcomes: ouOutcomes("OU_0_5", "0.5"),
      },
      {
        marketType: "OU_1_5",
        title: "Over/Under 1.5",
        outcomes: ouOutcomes("OU_1_5", "1.5"),
      },
      {
        marketType: "OU_2_5",
        title: "Over/Under 2.5",
        outcomes: ouOutcomes("OU_2_5", "2.5"),
      },
      {
        marketType: "OU_3_5",
        title: "Over/Under 3.5",
        outcomes: ouOutcomes("OU_3_5", "3.5"),
      },
      {
        marketType: "OU_4_5",
        title: "Over/Under 4.5",
        outcomes: ouOutcomes("OU_4_5", "4.5"),
      },
      {
        marketType: "BTTS",
        title: "Both Teams to Score",
        outcomes: [
          { marketType: "BTTS", selectionLabel: "Yes", display: "Yes" },
          { marketType: "BTTS", selectionLabel: "No", display: "No" },
        ],
      },
    ],
  },
  {
    id: "halves",
    title: "Halves",
    markets: [
      {
        marketType: "1H_1X2",
        title: "1H 1X2",
        outcomes: hxOutcomes("1H_1X2"),
      },
      {
        marketType: "1H_OU_0_5",
        title: "1H O/U 0.5",
        outcomes: ouOutcomes("1H_OU_0_5", "0.5"),
      },
      {
        marketType: "1H_OU_1_5",
        title: "1H O/U 1.5",
        outcomes: ouOutcomes("1H_OU_1_5", "1.5"),
      },
      {
        marketType: "2H_OU_0_5",
        title: "2H O/U 0.5",
        outcomes: ouOutcomes("2H_OU_0_5", "0.5"),
      },
      {
        marketType: "2H_OU_1_5",
        title: "2H O/U 1.5",
        outcomes: ouOutcomes("2H_OU_1_5", "1.5"),
      },
      {
        marketType: "HALF_MOST_GOALS",
        title: "Half with Most Goals",
        outcomes: [
          {
            marketType: "HALF_MOST_GOALS",
            selectionLabel: "1H",
            display: "1H",
          },
          {
            marketType: "HALF_MOST_GOALS",
            selectionLabel: "2H",
            display: "2H",
          },
          {
            marketType: "HALF_MOST_GOALS",
            selectionLabel: "Equal",
            display: "Equal",
          },
        ],
      },
    ],
  },
  {
    id: "combos",
    title: "Combos",
    markets: [
      {
        marketType: "RESULT_BTTS",
        title: "Result + BTTS",
        outcomes: [
          {
            marketType: "RESULT_BTTS",
            selectionLabel: "Home/Yes",
            display: "1+Yes",
          },
          {
            marketType: "RESULT_BTTS",
            selectionLabel: "Home/No",
            display: "1+No",
          },
          {
            marketType: "RESULT_BTTS",
            selectionLabel: "Draw/Yes",
            display: "X+Yes",
          },
          {
            marketType: "RESULT_BTTS",
            selectionLabel: "Draw/No",
            display: "X+No",
          },
          {
            marketType: "RESULT_BTTS",
            selectionLabel: "Away/Yes",
            display: "2+Yes",
          },
          {
            marketType: "RESULT_BTTS",
            selectionLabel: "Away/No",
            display: "2+No",
          },
        ],
      },
      {
        marketType: "RESULT_OU_2_5",
        title: "Result + O/U 2.5",
        outcomes: [
          {
            marketType: "RESULT_OU_2_5",
            selectionLabel: "Home/Over",
            display: "1+O",
          },
          {
            marketType: "RESULT_OU_2_5",
            selectionLabel: "Home/Under",
            display: "1+U",
          },
          {
            marketType: "RESULT_OU_2_5",
            selectionLabel: "Draw/Over",
            display: "X+O",
          },
          {
            marketType: "RESULT_OU_2_5",
            selectionLabel: "Draw/Under",
            display: "X+U",
          },
          {
            marketType: "RESULT_OU_2_5",
            selectionLabel: "Away/Over",
            display: "2+O",
          },
          {
            marketType: "RESULT_OU_2_5",
            selectionLabel: "Away/Under",
            display: "2+U",
          },
        ],
      },
    ],
  },
];

/** Flat list of every catalog outcome for skeleton upserts. */
export const FULL_MARKET_OUTCOMES: CatalogOutcome[] =
  FULL_MARKET_CATALOG.flatMap((c) =>
    c.markets.flatMap((m) => m.outcomes)
  );

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
export const QUICK_MARKET_DEFS: CatalogOutcome[] = [
  { marketType: "1X2", selectionLabel: "Home", display: "1" },
  { marketType: "1X2", selectionLabel: "Draw", display: "X" },
  { marketType: "1X2", selectionLabel: "Away", display: "2" },
  { marketType: "OU_2_5", selectionLabel: "Over", display: "O2.5" },
  { marketType: "BTTS", selectionLabel: "Yes", display: "BTTS" },
];

export const TRACKING_BANNER =
  "Tracking tool — records and settles slips against real match results. Odds/returns are for tracking only, not a guarantee.";

export const PHONE_STORAGE_NOTICE =
  "Your number is stored to label your slips.";

export const ADMIN_SLIPS_UNGUARDED_NOTICE =
  "This link is unguarded — anyone with it sees all submissions. Do not share it.";

export const ADMIN_USERS_UNGUARDED_NOTICE =
  "This link is unguarded — anyone with it sees all user identities and histories. Do not share it.";
