/**
 * Per-family candidate pools with deterministic tie-breaking.
 */
import type { BinCalibrator } from "@/lib/predictor/calibration";
import type { PoolFixture } from "./batch-pool";
import { enumerateAndGateFamily } from "./eligibility";
import type {
  CandidateLeg,
  FilteredLeg,
  MarketFamilyId,
  SlipPreferences,
} from "./types";
import { validateFamilySelection } from "./types";

const SCORE_TIE_EPS = 0.005;

/**
 * Tie-break order when scores within 0.005:
 * 1. larger n_effective
 * 2. narrower ciWidth
 * 3. lower correlation with already-placed (caller may pass rhoHint)
 * 4. earlier kickoff
 */
export function compareLegs(
  a: CandidateLeg,
  b: CandidateLeg,
  opts?: { rhoA?: number; rhoB?: number }
): number {
  const d = b.pCalibrated - a.pCalibrated;
  if (Math.abs(d) > SCORE_TIE_EPS) return d > 0 ? 1 : -1;
  if (a.nEffective !== b.nEffective) return b.nEffective - a.nEffective;
  if (a.ciWidth !== b.ciWidth) return a.ciWidth - b.ciWidth;
  const ra = opts?.rhoA ?? 0;
  const rb = opts?.rhoB ?? 0;
  if (ra !== rb) return ra - rb;
  if (a.kickoffMs !== b.kickoffMs) return a.kickoffMs - b.kickoffMs;
  // Stable final key for reproducibility
  const ka = `${a.fixtureId}|${a.family}|${a.selectionKey}`;
  const kb = `${b.fixtureId}|${b.family}|${b.selectionKey}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export function sortCandidates(legs: CandidateLeg[]): CandidateLeg[] {
  return [...legs].sort((a, b) => {
    const c = compareLegs(a, b);
    // compareLegs returns positive when b is better; sort ascending wants a before b when a better
    return -c;
  });
}

export type FamilyPool = {
  family: MarketFamilyId;
  eligible: CandidateLeg[];
  filtered: FilteredLeg[];
};

export type CandidatePoolResult = {
  byFamily: FamilyPool[];
  allFiltered: FilteredLeg[];
  familyError: string | null;
};

export function buildCandidatePools(input: {
  fixtures: PoolFixture[];
  prefs: SlipPreferences;
  calibrator: BinCalibrator | null;
}): CandidatePoolResult {
  const validation = validateFamilySelection(input.prefs.families);
  if (!validation.ok) {
    return {
      byFamily: [],
      allFiltered: [],
      familyError: `Conflict group ${validation.groupId}: ${validation.conflict[0]} and ${validation.conflict[1]} cannot both be selected.`,
    };
  }

  const byFamily: FamilyPool[] = [];
  const allFiltered: FilteredLeg[] = [];

  for (const family of input.prefs.families) {
    const { eligible, filtered } = enumerateAndGateFamily({
      fixtures: input.fixtures,
      family,
      prefs: input.prefs,
      calibrator: input.calibrator,
    });
    byFamily.push({
      family,
      eligible: sortCandidates(eligible),
      filtered,
    });
    allFiltered.push(...filtered);
  }

  return { byFamily, allFiltered, familyError: null };
}

/** Best leg per fixture for a family (for Hungarian K=1 layer). */
export function bestLegPerFixture(
  eligible: CandidateLeg[]
): Map<string, CandidateLeg> {
  const map = new Map<string, CandidateLeg>();
  for (const leg of sortCandidates(eligible)) {
    if (!map.has(leg.fixtureId)) map.set(leg.fixtureId, leg);
  }
  return map;
}
