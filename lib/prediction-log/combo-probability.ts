import { comboGridProbabilityPercent, getComboTierBoostKey } from "./combo-markets-config";
import { computePFinal } from "./master-probability";
import { shrinkPStat } from "./stat-probability";
import { applyTierBoostToPFinal } from "./teams-quality";
import type { TeamsQualityStore } from "./teams-quality-types";
import type {
  ComboMarketDef,
  ComboTypeLearnerStat,
  CombinedOddsSettings,
  RecommendedPickMathSnapshot,
} from "./types";

const MIN_LEARNER_COMBO_SAMPLE = 5;
const LEARNER_SHRINK_THRESHOLD = 55;

export interface ComboProbabilityInput {
  combo: ComboMarketDef;
  grid: number[][];
  lambdaHome?: number;
  lambdaAway?: number;
  mathSnapshot: RecommendedPickMathSnapshot | null | undefined;
  rBatch: number;
  homeTeam: string;
  awayTeam: string;
  minSample: number;
  settings: CombinedOddsSettings;
  teamsQuality?: TeamsQualityStore | null;
  comboTypeStats?: Record<string, ComboTypeLearnerStat>;
}

export interface ComboProbabilityResult {
  comboId: string;
  label: string;
  pGrid: number;
  pSignal: number;
  pStat: number;
  pFinalBase: number;
  pFinal: number;
  skipped: boolean;
  skipReason?: string;
}

function blendComboWithSignals(
  pGrid: number,
  signals: RecommendedPickMathSnapshot["signals"] | undefined
): number {
  if (!signals) return pGrid;
  const formNudge = (signals.recentForm - 0.5) * 8;
  const capNudge = (signals.capacityEdge - 0.5) * 6;
  const blended = pGrid + formNudge + capNudge;
  return Math.max(5, Math.min(95, Math.round(blended)));
}

function applyLearnerComboShrink(
  pFinal: number,
  comboId: string,
  comboTypeStats?: Record<string, ComboTypeLearnerStat>
): number {
  const stat = comboTypeStats?.[comboId];
  if (!stat) return pFinal;
  const sample = stat.wins + stat.losses;
  if (sample < MIN_LEARNER_COMBO_SAMPLE || stat.winRate == null) return pFinal;
  if (stat.winRate >= LEARNER_SHRINK_THRESHOLD) return pFinal;
  const gap = LEARNER_SHRINK_THRESHOLD - stat.winRate;
  const shrink = Math.min(15, Math.round(gap * 0.4));
  return Math.max(5, pFinal - shrink);
}

export function computeComboPFinal(input: ComboProbabilityInput): ComboProbabilityResult | null {
  const { combo, grid, settings } = input;

  if (combo.requiresHalfTime && (input.lambdaHome == null || input.lambdaAway == null)) {
    return {
      comboId: combo.id,
      label: combo.label,
      pGrid: 0,
      pSignal: 0,
      pStat: 0,
      pFinalBase: 0,
      pFinal: 0,
      skipped: true,
      skipReason: "HT data required",
    };
  }

  const pGrid = comboGridProbabilityPercent(combo.id, {
    grid,
    lambdaHome: input.lambdaHome,
    lambdaAway: input.lambdaAway,
  });

  if (pGrid == null) return null;

  const pSignal = blendComboWithSignals(pGrid, input.mathSnapshot?.signals);
  const pStat = shrinkPStat(pSignal, input.minSample, settings.comboShrinkMinSample);
  const pFinalBase = computePFinal(pStat, input.rBatch);

  const boostKey = getComboTierBoostKey(combo.id);
  const tierOverlay = applyTierBoostToPFinal(
    pFinalBase,
    input.homeTeam,
    input.awayTeam,
    boostKey.marketKey,
    boostKey.prediction,
    input.teamsQuality
  );

  const pFinal = applyLearnerComboShrink(
    tierOverlay.pFinalWithTier,
    combo.id,
    input.comboTypeStats
  );

  return {
    comboId: combo.id,
    label: combo.label,
    pGrid,
    pSignal,
    pStat,
    pFinalBase,
    pFinal,
    skipped: false,
  };
}

export function comboValue(pFinal: number, odds: number | null | undefined): number | null {
  if (odds == null || !Number.isFinite(odds) || odds <= 1) return null;
  return Math.round((pFinal / 100) * odds * 100 - 100) / 100;
}
