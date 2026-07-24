import { loadAllBatches } from "./club-store";
import { getJson, setJson } from "./kv";
import { KV_KEYS } from "./kv-keys";
import {
  emptySaSeasonRosterStore,
  type SaSeasonRosterStore,
} from "./sa-season-roster";
import { buildAllSaSeasonCards } from "./sa-team-season-stats";
import type { PredictionBatch } from "./types";

export async function loadSaSeasonRosterStore(): Promise<SaSeasonRosterStore> {
  const stored = await getJson<SaSeasonRosterStore>(KV_KEYS.saSeasonRoster);
  if (!stored?.teams?.length || !stored.cards) {
    return emptySaSeasonRosterStore();
  }
  return stored;
}

export async function saveSaSeasonRosterStore(
  store: SaSeasonRosterStore
): Promise<void> {
  await setJson(KV_KEYS.saSeasonRoster, store);
}

export async function recomputeSaSeasonCards(
  allBatches?: PredictionBatch[],
  existing?: SaSeasonRosterStore | null
): Promise<SaSeasonRosterStore> {
  const prev = existing ?? (await loadSaSeasonRosterStore());
  const batches = allBatches ?? (await loadAllBatches().catch(() => []));
  const paused = new Set(
    Object.values(prev.cards)
      .filter((c) => c.seed_paused)
      .map((c) => c.team)
  );
  for (const m of prev.mismatches) {
    paused.add(m.provisional);
  }
  const cards = buildAllSaSeasonCards(batches, paused, prev.teams);
  const store: SaSeasonRosterStore = {
    ...prev,
    cards,
    updatedAt: new Date().toISOString(),
  };
  await saveSaSeasonRosterStore(store);
  return store;
}
