/** Editable result-grid fields in tab/arrow order (core then full-stats). */
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

export type ResultCoreField = (typeof RESULT_CORE_FIELDS)[number];
export type ResultFullField = (typeof RESULT_FULL_FIELDS)[number];
export type ResultGridField = ResultCoreField | ResultFullField;

export function resultEditableFields(showFullStats: boolean): ResultGridField[] {
  return showFullStats
    ? [...RESULT_CORE_FIELDS, ...RESULT_FULL_FIELDS]
    : [...RESULT_CORE_FIELDS];
}
