/** API-Football free-plan sample window used by Live Refresh.
 * Dates map to AF seasons 2022–2024 (European seasons start in August).
 */
export const SAMPLE_DATE_MIN = "2022-08-01";
export const SAMPLE_DATE_MAX = "2024-12-31";

/** Sensible default: a busy PL Saturday in the free-plan window. */
export const SAMPLE_DATE_DEFAULT = "2023-09-16";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isSampleDateAllowed(value: string): boolean {
  return (
    isIsoDate(value) &&
    value >= SAMPLE_DATE_MIN &&
    value <= SAMPLE_DATE_MAX
  );
}

export function clampSampleDate(value: string | null | undefined): string {
  if (value && isSampleDateAllowed(value)) return value;
  return SAMPLE_DATE_DEFAULT;
}

export function assertSampleDate(value: string): string {
  const date = clampSampleDate(value);
  if (!isSampleDateAllowed(value ?? "")) {
    throw new Error(
      `Sample date must be between ${SAMPLE_DATE_MIN} and ${SAMPLE_DATE_MAX} (got ${value ?? "empty"})`
    );
  }
  return date;
}
