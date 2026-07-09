import { FootballPredictor } from "./index";
import type { MatchRow } from "./types";

export interface FitEngineOptions {
  decayXi?: number;
  promotedFallback?: boolean;
  includeAuxiliary?: boolean;
}

interface CacheEntry {
  engine: FootballPredictor;
  at: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function cacheKey(rows: MatchRow[], opts: FitEngineOptions): string {
  const n = rows.length;
  const first = rows[0]?.Date ?? "";
  const last = rows[n - 1]?.Date ?? "";
  return `${n}:${first}:${last}:${opts.decayXi ?? 0.002}:${Boolean(opts.promotedFallback)}:${Boolean(opts.includeAuxiliary ?? true)}`;
}

export function getFittedEngine(
  rows: MatchRow[],
  opts: FitEngineOptions = {}
): FootballPredictor {
  const decayXi = opts.decayXi ?? 0.002;
  const promotedFallback = Boolean(opts.promotedFallback);
  const includeAuxiliary = opts.includeAuxiliary ?? true;
  const key = cacheKey(rows, { decayXi, promotedFallback, includeAuxiliary });
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.engine;

  const engine = new FootballPredictor(
    [1.5, 2.5, 3.5],
    decayXi,
    [0.5, 1.5, 2.5],
    [8.5, 9.5, 10.5],
    { promotedFallback }
  );
  engine.fit(rows, { includeAuxiliary });
  cache.set(key, { engine, at: now });

  if (cache.size > 12) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, v] of cache) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }

  return engine;
}
