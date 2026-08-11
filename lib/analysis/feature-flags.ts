/**
 * Blended analysis feature flags — default OFF (legacy path only).
 */

export type AnalysisPageId =
  | "hsh"
  | "total-goals"
  | "dieh"
  | "ladder"
  | "corners"
  | "analysis"
  | "decision-maker";

function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultOn;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return defaultOn;
}

/**
 * Master switch — when false, zero adapter side effects on displayed metrics.
 * Client bundles also honor NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED so the
 * same flag can enable browser-side CFE envelopes + UI notice.
 */
export function isAnalysisBlendedModeEnabled(): boolean {
  return (
    envFlag("ANALYSIS_BLENDED_MODE_ENABLED", false) ||
    envFlag("NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED", false)
  );
}

/**
 * Optional page allowlist: ANALYSIS_BLENDED_PAGES=hsh,total-goals,dieh
 * Empty/unset = all pages allowed when master flag is on.
 */
export function isAnalysisBlendedPageEnabled(page: AnalysisPageId): boolean {
  if (!isAnalysisBlendedModeEnabled()) return false;
  const raw = process.env.ANALYSIS_BLENDED_PAGES?.trim();
  if (!raw) return true;
  const allow = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  return allow.has(page);
}

/** Client-safe snapshot for UI (build-time / public env). */
export function readBlendedModePublic(): boolean {
  if (typeof process === "undefined") return false;
  return (
    process.env.NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED === "1" ||
    process.env.NEXT_PUBLIC_ANALYSIS_BLENDED_MODE_ENABLED === "true" ||
    isAnalysisBlendedModeEnabled()
  );
}
