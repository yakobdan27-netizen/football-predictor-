import { BETTER_ALTERNATIVE_THRESHOLD_PCT } from "./recommendation-config";
import { DEFAULT_COMBO_MARKETS, mergeComboMarketsWithDefaults } from "./combo-markets-config";
import type { CombinedOddsSettings } from "./types";

export const COMBINED_ODDS_SETTINGS_KEY = "pl_combined_odds_settings";

export const DEFAULT_COMBO_TIER_MIN_PFINAL = {
  safe: 75,
  balanced: 62,
  aggressive: 50,
} as const;

export function defaultCombinedOddsSettings(): CombinedOddsSettings {
  return {
    markets: DEFAULT_COMBO_MARKETS.map((m) => ({ ...m })),
    tierMinPFinal: { ...DEFAULT_COMBO_TIER_MIN_PFINAL },
    betterAlternativeThresholdPct: BETTER_ALTERNATIVE_THRESHOLD_PCT,
    comboShrinkMinSample: 12,
    showSingleMarkets: true,
    showCombinedMarkets: true,
    highlightPositiveValue: true,
    warnNegativeValue: true,
    defaultMarketMode: "single",
  };
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadCombinedOddsSettings(): CombinedOddsSettings {
  if (!isBrowser()) return defaultCombinedOddsSettings();
  try {
    const raw = localStorage.getItem(COMBINED_ODDS_SETTINGS_KEY);
    if (!raw) return defaultCombinedOddsSettings();
    const parsed = JSON.parse(raw) as CombinedOddsSettings;
    const defaults = defaultCombinedOddsSettings();
    return {
      markets: mergeComboMarketsWithDefaults(Array.isArray(parsed.markets) ? parsed.markets : []),
      tierMinPFinal: {
        safe:
          typeof parsed.tierMinPFinal?.safe === "number"
            ? parsed.tierMinPFinal.safe
            : defaults.tierMinPFinal.safe,
        balanced:
          typeof parsed.tierMinPFinal?.balanced === "number"
            ? parsed.tierMinPFinal.balanced
            : defaults.tierMinPFinal.balanced,
        aggressive:
          typeof parsed.tierMinPFinal?.aggressive === "number"
            ? parsed.tierMinPFinal.aggressive
            : defaults.tierMinPFinal.aggressive,
      },
      betterAlternativeThresholdPct:
        typeof parsed.betterAlternativeThresholdPct === "number"
          ? parsed.betterAlternativeThresholdPct
          : defaults.betterAlternativeThresholdPct,
      comboShrinkMinSample:
        typeof parsed.comboShrinkMinSample === "number"
          ? parsed.comboShrinkMinSample
          : defaults.comboShrinkMinSample,
      showSingleMarkets: parsed.showSingleMarkets !== false,
      showCombinedMarkets: parsed.showCombinedMarkets !== false,
      highlightPositiveValue: parsed.highlightPositiveValue !== false,
      warnNegativeValue: parsed.warnNegativeValue !== false,
      defaultMarketMode:
        parsed.defaultMarketMode === "combined" ? "combined" : defaults.defaultMarketMode,
    };
  } catch {
    return defaultCombinedOddsSettings();
  }
}

export function saveCombinedOddsSettings(settings: CombinedOddsSettings): void {
  if (!isBrowser()) return;
  localStorage.setItem(COMBINED_ODDS_SETTINGS_KEY, JSON.stringify(settings));
}

export function tierMinPFinalForCombo(
  settings: CombinedOddsSettings,
  tier: "safe" | "balanced" | "aggressive"
): number {
  return settings.tierMinPFinal[tier];
}
