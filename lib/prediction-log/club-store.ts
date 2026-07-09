import type { PredictionBatch } from "./types";
import type {
  BatchIndex,
  ClubIndex,
  ClubRecord,
} from "./club-record-types";
import { KV_KEYS } from "./kv-keys";
import { getJson, setJson, delKey, incrementCounter } from "./kv";
import {
  buildIndexEntry,
  emptyClubIndex,
  findClubInIndex,
  nextClubId,
  slugifyClubName,
  upsertClubIndexEntry,
} from "./club-index";
import { createClubRecord } from "./club-record-types";

export async function loadClubIndex(): Promise<ClubIndex> {
  return (await getJson<ClubIndex>(KV_KEYS.clubIndex)) ?? emptyClubIndex();
}

export async function saveClubIndex(index: ClubIndex): Promise<void> {
  await setJson(KV_KEYS.clubIndex, index);
}

export async function loadBatchIndex(): Promise<BatchIndex> {
  return (
    (await getJson<BatchIndex>(KV_KEYS.batchIndex)) ?? {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      batchIds: [],
    }
  );
}

export async function saveBatchIndex(index: BatchIndex): Promise<void> {
  await setJson(KV_KEYS.batchIndex, index);
}

export async function loadClubRecord(clubId: string): Promise<ClubRecord | null> {
  return getJson<ClubRecord>(KV_KEYS.club(clubId));
}

export async function saveClubRecord(record: ClubRecord): Promise<void> {
  await setJson(KV_KEYS.club(record.clubId), record);
  const index = await loadClubIndex();
  await saveClubIndex(upsertClubIndexEntry(index, buildIndexEntry(record)));
}

export async function loadBatch(batchId: string): Promise<PredictionBatch | null> {
  return getJson<PredictionBatch>(KV_KEYS.batch(batchId));
}

export async function saveBatch(batch: PredictionBatch): Promise<void> {
  await setJson(KV_KEYS.batch(batch.id), batch);
  const index = await loadBatchIndex();
  const ids = new Set(index.batchIds);
  ids.add(batch.id);
  await saveBatchIndex({
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchIds: [...ids],
  });
}

export async function loadAllBatches(): Promise<PredictionBatch[]> {
  const index = await loadBatchIndex();
  const batches: PredictionBatch[] = [];
  for (const id of index.batchIds) {
    const b = await loadBatch(id);
    if (b) batches.push(b);
  }
  return batches.sort((a, b) =>
    `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`)
  );
}

export async function deleteBatch(batchId: string): Promise<void> {
  await delKey(KV_KEYS.batch(batchId));
  const index = await loadBatchIndex();
  await saveBatchIndex({
    ...index,
    batchIds: index.batchIds.filter((id) => id !== batchId),
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteAllBatches(): Promise<void> {
  const index = await loadBatchIndex();
  for (const id of index.batchIds) {
    await delKey(KV_KEYS.batch(id));
  }
  await saveBatchIndex({
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    batchIds: [],
  });
}

export async function findOrCreateClub(
  clubName: string,
  league: string
): Promise<ClubRecord> {
  let index = await loadClubIndex();
  const existing = findClubInIndex(index, clubName, league);
  if (existing) {
    const record = await loadClubRecord(existing.clubId);
    if (record) return record;
  }

  const counter = await incrementCounter(KV_KEYS.clubIdCounter);
  const slug = slugifyClubName(clubName);
  const clubId = nextClubId(slug, counter);
  const record = createClubRecord(clubId, clubName, league);
  await saveClubRecord(record);
  return record;
}

export async function loadAllClubRecords(): Promise<ClubRecord[]> {
  const index = await loadClubIndex();
  const records: ClubRecord[] = [];
  for (const entry of index.clubs) {
    const r = await loadClubRecord(entry.clubId);
    if (r) records.push(r);
  }
  return records;
}

export function batchIndexPopulated(index: BatchIndex): boolean {
  return index.batchIds.length > 0;
}
