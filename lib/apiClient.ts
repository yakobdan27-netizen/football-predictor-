/**
 * Sole HTTP transport for API-Football (api-sports.io direct).
 * Features must not call v3.football.api-sports.io themselves.
 *
 * Never log the API key. Missing key → ok:false (manual entry still works).
 */
import {
  backoffOn429,
  noteRateLimitHeaders,
  waitIfRateLimited,
  getLastQuotaRemaining,
} from "@/lib/live/rate-limit";

const DEFAULT_API_BASE = "https://v3.football.api-sports.io";

export const API_KEY_NOT_CONFIGURED_MSG =
  "APISPORTS_KEY (or API_FOOTBALL_KEY) is not configured";

const PLACEHOLDER_KEYS = new Set([
  "your_api_key_here",
  "changeme",
  "change_me",
  "xxx",
]);

export type ApiCacheKind =
  | "fixtures_pre"
  | "fixtures_live"
  | "team_stats"
  | "odds"
  | "standings"
  | "lineups"
  | "events"
  | "status"
  | "default";

const TTL_MS: Record<ApiCacheKind, number> = {
  fixtures_pre: 6 * 60 * 60 * 1000,
  fixtures_live: 30 * 1000,
  team_stats: 24 * 60 * 60 * 1000,
  odds: 5 * 60 * 1000,
  standings: 60 * 60 * 1000,
  lineups: 60 * 60 * 1000,
  events: 15 * 60 * 1000,
  status: 60 * 1000,
  default: 5 * 60 * 1000,
};

export type ApiClientResult<T> = {
  ok: boolean;
  data: T | null;
  error: string | null;
  plan_gated: boolean;
  status?: number;
  cached?: boolean;
  remaining?: number | null;
};

type AfEnvelope<T> = {
  get?: string;
  parameters?: Record<string, string>;
  errors?: Record<string, string> | string[];
  results?: number;
  paging?: { current: number; total: number };
  response: T;
};

type CacheEntry = { at: number; ttl: number; data: unknown };
const memoryCache = new Map<string, CacheEntry>();

let apiDisabledLogged = false;
let statusQuota: {
  at: number;
  plan: string | null;
  limitDay: number | null;
  current: number | null;
  active: boolean | null;
} | null = null;

export function getApiFootballBaseUrl(): string {
  const raw = (process.env.API_FOOTBALL_BASE_URL ?? "").trim().replace(/\/$/, "");
  return raw || DEFAULT_API_BASE;
}

export function isApiFootballConfigured(): boolean {
  try {
    getApiFootballKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer APISPORTS_KEY; fall back to legacy API_FOOTBALL_KEY.
 * Never log the key value.
 */
export function getApiFootballKey(): string {
  const key = (
    process.env.APISPORTS_KEY ??
    process.env.API_FOOTBALL_KEY ??
    ""
  ).trim();
  if (!key || PLACEHOLDER_KEYS.has(key.toLowerCase())) {
    if (!apiDisabledLogged) {
      console.error(
        "[apiClient] APISPORTS_KEY missing — API features disabled; manual entry still works"
      );
      apiDisabledLogged = true;
    }
    throw new Error(API_KEY_NOT_CONFIGURED_MSG);
  }
  return key;
}

export function isApiFootballKeyError(msg: string): boolean {
  return /APISPORTS_KEY|API_FOOTBALL_KEY|not configured/i.test(msg);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cacheKey(path: string, params: Record<string, string | number>): string {
  const keys = Object.keys(params).sort();
  const q = keys.map((k) => `${k}=${params[k]}`).join("&");
  return `${path}?${q}`;
}

function inferCacheKind(
  path: string,
  params: Record<string, string | number>
): ApiCacheKind {
  if (path.includes("/status")) return "status";
  if (path.includes("/odds")) return "odds";
  if (path.includes("/lineups")) return "lineups";
  if (path.includes("/standings")) return "standings";
  if (path.includes("/events")) return "events";
  if (path.includes("/statistics") || path.includes("/teams/statistics")) {
    return "team_stats";
  }
  if (path.includes("/fixtures")) {
    if (params.live != null || params.ids != null) return "fixtures_live";
    return "fixtures_pre";
  }
  return "default";
}

function readCache<T>(key: string): T | null {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    memoryCache.delete(key);
    return null;
  }
  return hit.data as T;
}

function writeCache(key: string, data: unknown, kind: ApiCacheKind): void {
  memoryCache.set(key, { at: Date.now(), ttl: TTL_MS[kind], data });
}

export function clearApiClientCache(): void {
  memoryCache.clear();
}

function isPlanGatedMessage(msg: string): boolean {
  return /plan|Free plans|subscription|401|403/i.test(msg);
}

function errorsToMessage(errors: AfEnvelope<unknown>["errors"]): string | null {
  if (!errors) return null;
  const msg =
    typeof errors === "object" && !Array.isArray(errors)
      ? JSON.stringify(errors)
      : String(errors);
  if (!msg || msg === "{}" || msg === "[]") return null;
  return msg;
}

async function throttleNearLimit(): Promise<void> {
  await waitIfRateLimited();
  const rem = getLastQuotaRemaining();
  if (rem != null && rem <= 5) {
    await sleep(1500);
  }
  if (
    statusQuota &&
    statusQuota.limitDay != null &&
    statusQuota.current != null &&
    statusQuota.limitDay > 0 &&
    statusQuota.current >= statusQuota.limitDay - 2
  ) {
    await sleep(2000);
  }
}

/**
 * Structured GET — preferred for new callers.
 */
export async function apiClientGet<T>(
  path: string,
  params: Record<string, string | number> = {},
  opts?: { cache?: ApiCacheKind | false; skipCache?: boolean }
): Promise<ApiClientResult<T>> {
  let key: string;
  try {
    key = getApiFootballKey();
  } catch (e) {
    return {
      ok: false,
      data: null,
      error: e instanceof Error ? e.message : API_KEY_NOT_CONFIGURED_MSG,
      plan_gated: true,
    };
  }

  const kind =
    opts?.cache === false
      ? null
      : opts?.cache ?? inferCacheKind(path, params);
  const ck = cacheKey(path, params);
  if (kind && !opts?.skipCache) {
    const cached = readCache<T>(ck);
    if (cached !== null) {
      return {
        ok: true,
        data: cached,
        error: null,
        plan_gated: false,
        cached: true,
        remaining: getLastQuotaRemaining(),
      };
    }
  }

  const base = getApiFootballBaseUrl();
  const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.append(k, String(v));
  }

  let lastError: string | null = null;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await throttleNearLimit();
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "x-apisports-key": key,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      noteRateLimitHeaders(res.headers);
      lastStatus = res.status;

      if (res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => "");
        const err = `HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`;
        return {
          ok: false,
          data: null,
          error: err,
          plan_gated: true,
          status: res.status,
          remaining: getLastQuotaRemaining(),
        };
      }

      if (res.status === 429) {
        await backoffOn429(attempt);
        lastError = "HTTP 429";
        continue;
      }

      if (res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        if (attempt < 2) {
          await sleep(2 ** attempt * 1000);
          continue;
        }
        return {
          ok: false,
          data: null,
          error: lastError,
          plan_gated: false,
          status: res.status,
          remaining: getLastQuotaRemaining(),
        };
      }

      if (!res.ok) {
        // Other 4xx — do not retry
        return {
          ok: false,
          data: null,
          error: `HTTP ${res.status}`,
          plan_gated: isPlanGatedMessage(`HTTP ${res.status}`),
          status: res.status,
          remaining: getLastQuotaRemaining(),
        };
      }

      const payload = (await res.json()) as AfEnvelope<T>;
      const errMsg = errorsToMessage(payload.errors);
      if (errMsg) {
        return {
          ok: false,
          data: null,
          error: `API errors: ${errMsg}`,
          plan_gated: isPlanGatedMessage(errMsg),
          status: res.status,
          remaining: getLastQuotaRemaining(),
        };
      }

      const data = payload.response;
      if (kind) writeCache(ck, data, kind);

      return {
        ok: true,
        data,
        error: null,
        plan_gated: false,
        status: res.status,
        cached: false,
        remaining: getLastQuotaRemaining(),
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < 2 && /HTTP 429|network|fetch|ECONN|ETIMEDOUT|5\d\d/i.test(lastError)) {
        await sleep(2 ** attempt * 1000);
        continue;
      }
      break;
    }
  }

  return {
    ok: false,
    data: null,
    error: lastError ?? `API request failed for ${path}`,
    plan_gated: isPlanGatedMessage(lastError ?? ""),
    status: lastStatus,
    remaining: getLastQuotaRemaining(),
  };
}

/**
 * Compatibility helper — throws on failure (legacy callers).
 * Prefer apiClientGet for new code.
 */
export async function apiFootballGet<T>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const result = await apiClientGet<T>(path, params);
  if (!result.ok || result.data === null) {
    throw new Error(
      `API request failed for ${path}: ${result.error ?? "unknown"}`
    );
  }
  return result.data;
}

/** Health check — logs plan/quota only (never the key). */
export async function logApiFootballHealth(): Promise<{
  ok: boolean;
  plan: string | null;
  limitDay: number | null;
  current: number | null;
  active: boolean | null;
  error?: string;
}> {
  const result = await apiClientGet<{
    subscription?: { plan?: string; active?: boolean; end?: string };
    requests?: { current?: number; limit_day?: number };
  }>("/status", {}, { cache: "status", skipCache: true });

  if (!result.ok || !result.data) {
    console.warn("[apiClient] /status failed:", result.error);
    return {
      ok: false,
      plan: null,
      limitDay: null,
      current: null,
      active: null,
      error: result.error ?? "status failed",
    };
  }

  const plan = result.data.subscription?.plan ?? null;
  const limitDay = result.data.requests?.limit_day ?? null;
  const current = result.data.requests?.current ?? null;
  const active = result.data.subscription?.active ?? null;
  statusQuota = { at: Date.now(), plan, limitDay, current, active };
  console.info(
    `[apiClient] plan=${plan} limit_day=${limitDay} current=${current} active=${active}`
  );
  return { ok: true, plan, limitDay, current, active };
}

export type ApiFootballResponse<T> = AfEnvelope<T>;
