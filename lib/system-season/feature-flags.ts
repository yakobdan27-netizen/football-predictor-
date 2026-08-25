/** When enabled, 30% last-5 MC + 30% prior API + 40% system_season_* blend is active. */
export function isSystemSeasonBlendEnabled(): boolean {
  const raw = process.env.SYSTEM_SEASON_BLEND_ENABLED;
  if (raw == null || raw === "") return true;
  return raw === "1" || raw.toLowerCase() === "true";
}
