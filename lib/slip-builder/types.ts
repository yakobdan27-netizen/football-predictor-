/**
 * Portfolio Bet Slip Builder — occurrence-probability types.
 * Selection ranks only on calibrated occurrence probability.
 */

export const MARKET_FAMILY_IDS = [
  "RESULT_1X2",
  "DOUBLE_CHANCE",
  "HANDICAP",
  "TOTALS",
  "TEAM_GOALS",
  "BTTS",
  "HALF_GOALS",
  "HT_RESULT",
  "DIEH",
  "CORNERS",
  "COMBO",
] as const;

export type MarketFamilyId = (typeof MARKET_FAMILY_IDS)[number];

/** Conflict groups — at most one family per group per batch. */
export const CONFLICT_GROUPS: ReadonlyArray<{
  id: string;
  members: readonly MarketFamilyId[];
}> = [
  {
    id: "G1",
    members: ["RESULT_1X2", "DOUBLE_CHANCE", "HANDICAP"],
  },
  {
    id: "G2",
    members: ["TOTALS", "TEAM_GOALS"],
  },
  {
    id: "G3",
    members: ["HALF_GOALS", "HT_RESULT", "DIEH"],
  },
  {
    id: "G4",
    members: ["BTTS", "CORNERS", "COMBO"],
  },
] as const;

export type FamilyValidation =
  | { ok: true }
  | { ok: false; conflict: [MarketFamilyId, MarketFamilyId]; groupId: string };

export function conflictGroupOf(family: MarketFamilyId): string | null {
  for (const g of CONFLICT_GROUPS) {
    if (g.members.includes(family)) return g.id;
  }
  return null;
}

/** Hard constraint: at most one family per conflict group. */
export function validateFamilySelection(
  families: readonly MarketFamilyId[]
): FamilyValidation {
  const seen = new Map<string, MarketFamilyId>();
  for (const f of families) {
    const g = conflictGroupOf(f);
    if (!g) continue;
    const prev = seen.get(g);
    if (prev && prev !== f) {
      return { ok: false, conflict: [prev, f], groupId: g };
    }
    seen.set(g, f);
  }
  return { ok: true };
}

export type ExclusionReason =
  | "probability_floor"
  | "sample_insufficiency"
  | "data_incomplete"
  | "coherence"
  | "freshness"
  | "uncalibrated"
  | "family_unavailable";

export type SelectionSource = "machine" | "manual_add" | "swap";

export type SlipPreferences = {
  /** Q1 — exactly four preferred; optimiser may return fewer if not viable. */
  families: MarketFamilyId[];
  /** Q2 — legs per slip (1–6). */
  legsPerSlip: number;
  /** Q3 — minimum calibrated probability. */
  pMin: number;
  /** Q4 — competitions to include (empty = all six). */
  competitions: string[];
  /** Q5 — batch window. */
  windowStart: string;
  windowEnd: string;
  /** Q6 — max legs from any one competition. */
  maxLegsPerCompetition: number;
  /** Q7 — exclude uncalibrated markets. */
  excludeUncalibrated: boolean;
  /** Q8 — within-slip correlation ceiling. */
  correlationCeiling: number;
  /** Q9 — record-only note; never read by selection engine. */
  userNote: string;
};

export const DEFAULT_SLIP_PREFERENCES: SlipPreferences = {
  families: ["RESULT_1X2", "TOTALS", "DIEH", "COMBO"],
  legsPerSlip: 3,
  pMin: 0.6,
  competitions: [],
  windowStart: "",
  windowEnd: "",
  maxLegsPerCompetition: 2,
  excludeUncalibrated: true,
  correlationCeiling: 0.35,
  userNote: "",
};

export type CandidateLeg = {
  fixtureId: string;
  apiFixtureId: number | null;
  matchId: string;
  sourceBatchId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffIso: string;
  kickoffMs: number;
  family: MarketFamilyId;
  selectionKey: string;
  selectionLabel: string;
  line: number | null;
  comboId: string | null;
  pRaw: number;
  pCalibrated: number;
  nEffective: number;
  ciWidth: number;
  calibrated: boolean;
  coherenceOk: boolean;
};

export type FilteredLeg = CandidateLeg & {
  reasons: ExclusionReason[];
};

export type BuiltSlipLeg = CandidateLeg & {
  selectionSource: SelectionSource;
  machineRank: number | null;
  correlationContribution: number;
  warning?: string;
};

export type BuiltSlip = {
  slipIndex: number;
  family: MarketFamilyId;
  legs: BuiltSlipLeg[];
  independenceUpper: number;
  bandLower: number;
  bandUpper: number;
  meanRho: number;
  provisional: boolean;
  manuallyAltered: boolean;
};

export type SlipBatchResult = {
  batchId: string;
  batchNumber: number;
  generatedAt: string;
  preferences: SlipPreferences;
  slips: BuiltSlip[];
  filtered: FilteredLeg[];
  partialReason: string | null;
  fixtureExclusionIds: string[];
};

export type FamilySelectionDef = {
  selectionKey: string;
  selectionLabel: string;
  line?: number;
  comboId?: string;
};
