import { loadAllBatches } from "./club-store";
import { getJson, setJson } from "./kv";
import { KV_KEYS } from "./kv-keys";
import {
  emptyLlSeasonRosterStore,
  type LlSeasonRosterStore,
} from "./ll-season-roster";
import { buildAllLlSeasonCards } from "./ll-team-season-stats";
import type { PredictionBatch } from "./types";

export async function loadLlSeasonRosterStore(): Promise<LlSeasonRosterStore> {
  const stored = await getJson<LlSeasonRosterStore>(KV_KEYS.llSeasonRoster);
  if (!stored?.teams?.length || !stored.cards) {
    return emptyLlSeasonRosterStore();
  }
  return stored;
}

export async function saveLlSeasonRosterStore(
  store: LlSeasonRosterStore
): Promise<void> {
  await setJson(KV_KEYS.llSeasonRoster, store);
}

export async function recomputeLlSeasonCards(
  allBatches?: PredictionBatch[],
  existing?: LlSeasonRosterStore | null
): Promise<LlSeasonRosterStore> {
  const prev = existing ?? (await loadLlSeasonRosterStore());
  const batches = allBatches ?? (await loadAllBatches().catch(() => []));
  const paused = new Set(
    Object.values(prev.cards)
      .filter((c) => c.seed_paused)
      .map((c) => c.team)
  );
  for (const m of prev.mismatches) {
    paused.add(m.provisional);
  }
  const cards = buildAllLlSeasonCards(batches, paused, prev.teams);
  const store: LlSeasonRosterStore = {
    ...prev,
    cards,
    updatedAt: new Date().toISOString(),
  };
  await saveLlSeasonRosterStore(store);
  return store;
}
