/** Editable result-grid fields in tab/arrow order (score-first, then optional extras). */

/** Default result keyboard path: FT home → FT away only. */
export const RESULT_SCORE_FIELDS = ["ftH", "ftA"] as const;

/** Shown when "Show full stats" is on (after FT score). */
export const RESULT_OPTIONAL_CORE_FIELDS = ["htH", "htA", "early"] as const;

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
  "corH",
  "corA",
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

export type ResultScoreField = (typeof RESULT_SCORE_FIELDS)[number];
export type ResultCoreField = (typeof RESULT_CORE_FIELDS)[number];
export type ResultFullField = (typeof RESULT_FULL_FIELDS)[number];
export type ResultGridField =
  | ResultScoreField
  | ResultCoreField
  | ResultFullField;

export function resultEditableFields(showFullStats: boolean): ResultGridField[] {
  if (!showFullStats) return [...RESULT_SCORE_FIELDS];
  return [
    ...RESULT_SCORE_FIELDS,
    ...RESULT_OPTIONAL_CORE_FIELDS,
    ...RESULT_FULL_FIELDS,
  ];
}
