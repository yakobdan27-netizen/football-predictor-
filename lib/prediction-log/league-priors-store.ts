import { loadAllBatches } from "./club-store";
import { getJson, setJson } from "./kv";
import { KV_KEYS } from "./kv-keys";
import { recomputeLeagueProfiles } from "./league-profiles";
import {
  compactPriorsFromProfiles,
  emptyLeaguePriorsStore,
  type LeaguePriorRecord,
  type LeaguePriorsStore,
} from "./league-priors";
import type { PredictionBatch } from "./types";

export async function loadLeaguePriorsStore(): Promise<LeaguePriorsStore> {
  const stored = await getJson<LeaguePriorsStore>(KV_KEYS.leaguePriors);
  if (!stored?.priors || typeof stored.priors !== "object") {
    return emptyLeaguePriorsStore();
  }
  return stored;
}

export async function saveLeaguePriorsStore(store: LeaguePriorsStore): Promise<void> {
  await setJson(KV_KEYS.leaguePriors, store);
}

/**
 * Recompute league character profiles from batches, compact to priors, persist KV.
 */
export async function recomputeAndPersistLeaguePriors(
  allBatches?: PredictionBatch[]
): Promise<LeaguePriorsStore> {
  const batches = allBatches ?? (await loadAllBatches());
  const profiles = recomputeLeagueProfiles(batches);
  const store = compactPriorsFromProfiles(profiles);
  await saveLeaguePriorsStore(store);
  return store;
}

/** Upsert a single prior (admin manual edit) and persist. */
export async function upsertLeaguePriorRecord(
  prior: LeaguePriorRecord
): Promise<LeaguePriorsStore> {
  const store = await loadLeaguePriorsStore();
  const updated: LeaguePriorsStore = {
    ...store,
    updatedAt: new Date().toISOString(),
    priors: {
      ...store.priors,
      [prior.leagueId]: {
        ...prior,
        source: prior.source === "seed" ? "manual" : prior.source,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  await saveLeaguePriorsStore(updated);
  return updated;
}
