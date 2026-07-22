import { KV_KEYS } from "./kv-keys";
import { getJson, setJson } from "./kv";
import type { ManualResultRecord } from "./manual-results-types";

export interface ManualResultsIndex {
  schemaVersion: 1;
  updatedAt: string;
  ids: string[];
}

async function loadIndex(): Promise<ManualResultsIndex> {
  return (
    (await getJson<ManualResultsIndex>(KV_KEYS.manualResultsIndex)) ?? {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      ids: [],
    }
  );
}

async function saveIndex(index: ManualResultsIndex): Promise<void> {
  await setJson(KV_KEYS.manualResultsIndex, index);
}

export async function getManualResult(
  id: string
): Promise<ManualResultRecord | null> {
  return getJson<ManualResultRecord>(KV_KEYS.manualResult(id));
}

export async function saveManualResult(
  record: ManualResultRecord
): Promise<void> {
  await setJson(KV_KEYS.manualResult(record.id), record);
  const index = await loadIndex();
  const ids = [record.id, ...index.ids.filter((x) => x !== record.id)];
  await saveIndex({
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    ids,
  });
}

/** Newest first (index order). */
export async function listManualResults(): Promise<ManualResultRecord[]> {
  const index = await loadIndex();
  const out: ManualResultRecord[] = [];
  for (const id of index.ids) {
    const row = await getManualResult(id);
    if (row) out.push(row);
  }
  return out;
}

export function newManualResultId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `mr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
