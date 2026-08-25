/** Editable result-grid fields in tab/arrow order (score-first, then optional extras). */

/** Default result keyboard path: FT home → FT away only. */
export const RESULT_SCORE_FIELDS = ["ftH", "ftA"] as const;

/** Always visible after FT — rich settlement fields. */
export const RESULT_RICH_FIELDS = [
  "htH",
  "htA",
  "corH",
  "corA",
  "t0_15",
  "t16_30",
  "t31_45",
  "t46_60",
  "t61_75",
  "t76_90",
] as const;

/** Shown when "Show full stats" is on (after rich block). */
export const RESULT_OPTIONAL_CORE_FIELDS = ["early"] as const;

/** Legacy core order used by paste tests (HT then FT then early). */
export const RESULT_CORE_FIELDS = [
  "htH",
  "htA",
  "ftH",
  "ftA",
  "early",
] as const;

export const RESULT_FULL_FIELDS = [
  "shotsH",
  "shotsA",
  "sotH",
  "sotA",
  "foulH",
  "foulA",
  "yelH",
  "yelA",
  "redH",
  "redA",
  "possH",
  "offH",
  "offA",
  "firstGoal",
  "penH",
  "penA",
  "abnormal",
] as const;

export type ResultRichField = (typeof RESULT_RICH_FIELDS)[number];
export type ResultScoreField = (typeof RESULT_SCORE_FIELDS)[number];
export type ResultCoreField = (typeof RESULT_CORE_FIELDS)[number];
export type ResultFullField = (typeof RESULT_FULL_FIELDS)[number];
export type ResultGridField =
  | ResultScoreField
  | ResultRichField
  | ResultCoreField
  | ResultFullField;

export function resultEditableFields(showFullStats: boolean): ResultGridField[] {
  const rich = [...RESULT_SCORE_FIELDS, ...RESULT_RICH_FIELDS];
  if (!showFullStats) return rich;
  return [...rich, ...RESULT_OPTIONAL_CORE_FIELDS, ...RESULT_FULL_FIELDS];
}
