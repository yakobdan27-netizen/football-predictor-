/**
 * Feature flags for the additive core_* layer.
 * Defaults keep all page reads on legacy stores.
 */

function envFlag(name: string, defaultOn: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultOn;
  const v = raw.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return defaultOn;
}

/** Write provenance rows into core_result_trace (does not change KV settlement). */
export function isCoreResultTraceWriteEnabled(): boolean {
  return envFlag("CORE_RESULT_TRACE_WRITE", true);
}

/**
 * When enabled, selected helpers may log hist vs analytics_v_fixture_compat diffs.
 * Pages still return legacy data.
 */
export function isCoreShadowFixtureReadEnabled(): boolean {
  return envFlag("CORE_SHADOW_FIXTURE_READ", false);
}
