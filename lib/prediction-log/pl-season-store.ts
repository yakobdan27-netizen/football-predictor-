import { loadAllBatches } from "./club-store";
import { getJson, setJson } from "./kv";
import { KV_KEYS } from "./kv-keys";
import {
  emptyPlSeasonRosterStore,
  type PlSeasonRosterStore,
} from "./pl-season-roster";
import { buildAllPlSeasonCards } from "./pl-team-season-stats";
import type { PredictionBatch } from "./types";

export async function loadPlSeasonRosterStore(): Promise<PlSeasonRosterStore> {
  const stored = await getJson<PlSeasonRosterStore>(KV_KEYS.plSeasonRoster);
  if (!stored?.teams?.length || !stored.cards) {
    return emptyPlSeasonRosterStore();
  }
  return stored;
}

export async function savePlSeasonRosterStore(
  store: PlSeasonRosterStore
): Promise<void> {
  await setJson(KV_KEYS.plSeasonRoster, store);
}

/** Rebuild cards from live batches, preserving verify/mismatch/seed_paused flags. */
export async function recomputePlSeasonCards(
  allBatches?: PredictionBatch[],
  existing?: PlSeasonRosterStore | null
): Promise<PlSeasonRosterStore> {
  const prev = existing ?? (await loadPlSeasonRosterStore());
  const batches = allBatches ?? (await loadAllBatches().catch(() => []));
  const paused = new Set(
    Object.values(prev.cards)
      .filter((c) => c.seed_paused)
      .map((c) => c.team)
  );
  for (const m of prev.mismatches) {
    paused.add(m.provisional);
  }
  const cards = buildAllPlSeasonCards(batches, paused);
  const store: PlSeasonRosterStore = {
    ...prev,
    cards,
    updatedAt: new Date().toISOString(),
  };
  await savePlSeasonRosterStore(store);
  return store;
}
