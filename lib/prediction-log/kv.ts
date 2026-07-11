import { kv as vercelKv } from "@vercel/kv";

const memoryStore = new Map<string, string>();

function useMemoryFallback(): boolean {
  return !process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN;
}

export function kvConfigured(): boolean {
  return !useMemoryFallback();
}

export async function getJson<T>(key: string): Promise<T | null> {
  if (useMemoryFallback()) {
    const raw = memoryStore.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  const value = await vercelKv.get<T>(key);
  return value ?? null;
}

export async function setJson(key: string, value: unknown): Promise<void> {
  if (useMemoryFallback()) {
    memoryStore.set(key, JSON.stringify(value));
    return;
  }
  await vercelKv.set(key, value);
}

/** Persist JSON with optional TTL (seconds). Memory fallback ignores TTL. */
export async function setJsonEx(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  if (useMemoryFallback()) {
    memoryStore.set(key, JSON.stringify(value));
    return;
  }
  await vercelKv.set(key, value, { ex: ttlSeconds });
}

export async function delKey(key: string): Promise<void> {
  if (useMemoryFallback()) {
    memoryStore.delete(key);
    return;
  }
  await vercelKv.del(key);
}

export async function mgetJson<T>(keys: string[]): Promise<(T | null)[]> {
  if (!keys.length) return [];
  if (useMemoryFallback()) {
    return keys.map((key) => {
      const raw = memoryStore.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    });
  }
  const values = await vercelKv.mget<T[]>(...keys);
  return (values ?? []).map((v) => v ?? null);
}

export async function incrementCounter(key: string): Promise<number> {
  const current = (await getJson<number>(key)) ?? 0;
  const next = current + 1;
  await setJson(key, next);
  return next;
}
