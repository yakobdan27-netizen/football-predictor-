/**
 * Helpers for sparse fixture statistics — NULL ≠ 0.
 */

/** Preserve null/undefined; never coerce missing to zero. */
export function preserveNullableStat(
  value: number | null | undefined
): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

export function isMissingStat(value: number | null | undefined): boolean {
  return value == null;
}
