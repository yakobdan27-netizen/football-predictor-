import { readFileSync } from "fs";
import path from "path";
import { getJson, setJson } from "./kv";
import { KV_KEYS } from "./kv-keys";
import { emptyTeamsQualityStore, normalizeStore, setRosterQualityStore } from "./teams-quality";
import type { TeamsQualityStore } from "./teams-quality-types";

function seedFromFile(): TeamsQualityStore | null {
  try {
    const seedPath = path.join(process.cwd(), "data", "teams-quality.json");
    const raw = readFileSync(seedPath, "utf-8");
    return normalizeStore(JSON.parse(raw) as TeamsQualityStore);
  } catch {
    return null;
  }
}

export async function loadTeamsQualityStore(): Promise<TeamsQualityStore> {
  const fromKv = await getJson<TeamsQualityStore>(KV_KEYS.teamsQuality);
  if (fromKv) {
    const normalized = normalizeStore(fromKv);
    setRosterQualityStore(normalized);
    return normalized;
  }

  const seed = seedFromFile() ?? emptyTeamsQualityStore();
  await setJson(KV_KEYS.teamsQuality, seed);
  setRosterQualityStore(seed);
  return seed;
}

export async function saveTeamsQualityStore(store: TeamsQualityStore): Promise<TeamsQualityStore> {
  const normalized = normalizeStore({
    ...store,
    last_updated: new Date().toISOString(),
  });
  await setJson(KV_KEYS.teamsQuality, normalized);
  setRosterQualityStore(normalized);
  return normalized;
}
