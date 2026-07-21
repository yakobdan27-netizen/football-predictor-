import { loadAllBatches } from "./club-store";
import { getJson, setJson } from "./kv";
import { KV_KEYS } from "./kv-keys";
import {
  emptyBlSeasonRosterStore,
  type BlSeasonRosterStore,
} from "./bl-season-roster";
import { buildAllBlSeasonCards } from "./bl-team-season-stats";
import type { PredictionBatch } from "./types";

export async function loadBlSeasonRosterStore(): Promise<BlSeasonRosterStore> {
  const stored = await getJson<BlSeasonRosterStore>(KV_KEYS.blSeasonRoster);
  if (!stored || typeof stored !== "object") {
    return emptyBlSeasonRosterStore();
  }
  return {
    ...emptyBlSeasonRosterStore(),
    ...stored,
    teams: Array.isArray(stored.teams) ? stored.teams : [],
    cards: stored.cards ?? {},
  };
}

export async function saveBlSeasonRosterStore(
  store: BlSeasonRosterStore
): Promise<void> {
  await setJson(KV_KEYS.blSeasonRoster, store);
}

export async function recomputeBlSeasonCards(
  allBatches?: PredictionBatch[],
  existing?: BlSeasonRosterStore | null
): Promise<BlSeasonRosterStore> {
  const prev = existing ?? (await loadBlSeasonRosterStore());
  const batches = allBatches ?? (await loadAllBatches().catch(() => []));
  const paused = new Set(
    Object.values(prev.cards)
      .filter((c) => c.seed_paused)
      .map((c) => c.team)
  );
  for (const m of prev.mismatches) {
    paused.add(m.provisional);
  }
  const cards = buildAllBlSeasonCards(batches, paused, prev.teams);
  const store: BlSeasonRosterStore = {
    ...prev,
    cards,
    updatedAt: new Date().toISOString(),
  };
  await saveBlSeasonRosterStore(store);
  return store;
}
