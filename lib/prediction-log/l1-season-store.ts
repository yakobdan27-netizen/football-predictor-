import { loadAllBatches } from "./club-store";
import { getJson, setJson } from "./kv";
import { KV_KEYS } from "./kv-keys";
import {
  emptyL1SeasonRosterStore,
  type L1SeasonRosterStore,
} from "./l1-season-roster";
import { buildAllL1SeasonCards } from "./l1-team-season-stats";
import type { PredictionBatch } from "./types";

export async function loadL1SeasonRosterStore(): Promise<L1SeasonRosterStore> {
  const stored = await getJson<L1SeasonRosterStore>(KV_KEYS.l1SeasonRoster);
  if (!stored || typeof stored !== "object") {
    return emptyL1SeasonRosterStore();
  }
  return {
    ...emptyL1SeasonRosterStore(),
    ...stored,
    teams: Array.isArray(stored.teams) ? stored.teams : [],
    cards: stored.cards ?? {},
  };
}

export async function saveL1SeasonRosterStore(
  store: L1SeasonRosterStore
): Promise<void> {
  await setJson(KV_KEYS.l1SeasonRoster, store);
}

export async function recomputeL1SeasonCards(
  allBatches?: PredictionBatch[],
  existing?: L1SeasonRosterStore | null
): Promise<L1SeasonRosterStore> {
  const prev = existing ?? (await loadL1SeasonRosterStore());
  const batches = allBatches ?? (await loadAllBatches().catch(() => []));
  const paused = new Set(
    Object.values(prev.cards)
      .filter((c) => c.seed_paused)
      .map((c) => c.team)
  );
  for (const m of prev.mismatches) {
    paused.add(m.provisional);
  }
  const cards = buildAllL1SeasonCards(batches, paused, prev.teams);
  const store: L1SeasonRosterStore = {
    ...prev,
    cards,
    updatedAt: new Date().toISOString(),
  };
  await saveL1SeasonRosterStore(store);
  return store;
}
