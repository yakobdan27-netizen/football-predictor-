/** Live Refresh date window.
 * Free API-Football plans only cover seasons ~2022–2024.
 * Paid plans use a wider historical range.
 */

/** Free-plan sample window (AF seasons 2022–2024). */
export const FREE_SAMPLE_DATE_MIN = "2022-08-01";
export const FREE_SAMPLE_DATE_MAX = "2024-12-31";

/** Paid-plan refresh window (deep history + near future). */
export const PAID_SAMPLE_DATE_MIN = "2018-08-01";

/** @deprecated Prefer FREE_* / resolveSampleWindow — kept for imports. */
export const SAMPLE_DATE_MIN = FREE_SAMPLE_DATE_MIN;
/** @deprecated Prefer FREE_* / resolveSampleWindow — kept for imports. */
export const SAMPLE_DATE_MAX = FREE_SAMPLE_DATE_MAX;

/** Sensible default: a busy PL Saturday in the free-plan window. */
export const SAMPLE_DATE_DEFAULT = "2023-09-16";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SampleWindowBounds = {
  min: string;
  max: string;
  isFree: boolean;
};

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function resolveSampleWindow(isFree: boolean): SampleWindowBounds {
  if (isFree) {
    return {
      min: FREE_SAMPLE_DATE_MIN,
      max: FREE_SAMPLE_DATE_MAX,
      isFree: true,
    };
  }
  return {
    min: PAID_SAMPLE_DATE_MIN,
    max: addDaysIso(todayUtcIso(), 14),
    isFree: false,
  };
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isSampleDateAllowed(
  value: string,
  bounds?: SampleWindowBounds | { min: string; max: string }
): boolean {
  const min = bounds?.min ?? FREE_SAMPLE_DATE_MIN;
  const max = bounds?.max ?? FREE_SAMPLE_DATE_MAX;
  return isIsoDate(value) && value >= min && value <= max;
}

export function clampSampleDate(
  value: string | null | undefined,
  bounds?: SampleWindowBounds | { min: string; max: string }
): string {
  if (value && isSampleDateAllowed(value, bounds)) return value;
  const min = bounds?.min ?? FREE_SAMPLE_DATE_MIN;
  const max = bounds?.max ?? FREE_SAMPLE_DATE_MAX;
  if (isSampleDateAllowed(SAMPLE_DATE_DEFAULT, bounds)) {
    return SAMPLE_DATE_DEFAULT;
  }
  return min <= max ? min : SAMPLE_DATE_DEFAULT;
}

export function assertSampleDate(
  value: string,
  bounds?: SampleWindowBounds | { min: string; max: string }
): string {
  const window = bounds ?? {
    min: FREE_SAMPLE_DATE_MIN,
    max: FREE_SAMPLE_DATE_MAX,
  };
  if (!isSampleDateAllowed(value ?? "", window)) {
    throw new Error(
      `Sample date must be between ${window.min} and ${window.max} (got ${value ?? "empty"})`
    );
  }
  return clampSampleDate(value, window);
}
