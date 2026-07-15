import { kv as vercelKv } from "@vercel/kv";

const memoryStore = new Map<string, string>();

function useMemoryFallback(): boolean {
  return !process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN;
}

export function kvConfigured(): boolean {
  return !useMemoryFallback();
}

/**
 * Retries transient network failures (e.g. DNS blips against the Upstash REST
 * endpoint) a few times with backoff before giving up, so long-running bulk jobs
 * don't die on a single flaky request.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        // Cap backoff at 20s — DNS/network blips against the KV endpoint have been
        // observed to last well beyond a few seconds in this environment.
        const delay = Math.min(20000, 500 * Math.pow(2, i));
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
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
  const value = await withRetry(() => vercelKv.get<T>(key));
  return value ?? null;
}

export async function setJson(key: string, value: unknown): Promise<void> {
  if (useMemoryFallback()) {
    memoryStore.set(key, JSON.stringify(value));
    return;
  }
  await withRetry(() => vercelKv.set(key, value));
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
  await withRetry(() => vercelKv.set(key, value, { ex: ttlSeconds }));
}

export async function delKey(key: string): Promise<void> {
  if (useMemoryFallback()) {
    memoryStore.delete(key);
    return;
  }
  await withRetry(() => vercelKv.del(key));
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
  const values = await withRetry(() => vercelKv.mget<T[]>(...keys));
  return (values ?? []).map((v) => v ?? null);
}

export async function incrementCounter(key: string): Promise<number> {
  const current = (await getJson<number>(key)) ?? 0;
  const next = current + 1;
  await setJson(key, next);
  return next;
}
