const DEFAULT_BASE = "https://api.thestatsapi.com/api";

export const STATS_API_KEY_NOT_CONFIGURED_MSG =
  "STATS_API_KEY is not configured";

const PLACEHOLDER_KEYS = new Set([
  "your_api_key_here",
  "changeme",
  "change_me",
  "xxx",
  "{{apikey}}",
  "1234567890",
]);

export function getStatsApiBaseUrl(): string {
  const raw = (process.env.STATS_API_BASE_URL ?? "").trim().replace(/\/$/, "");
  return raw || DEFAULT_BASE;
}

/**
 * Prefer STATS_API_KEY; accept legacy BESOCCER_API_KEY only if it looks like a
 * Stats API key (fapi_…) during migration.
 */
export function peekStatsApiKey(): string | null {
  const primary = (process.env.STATS_API_KEY ?? "").trim();
  if (primary && !PLACEHOLDER_KEYS.has(primary.toLowerCase())) return primary;
  const legacy = (process.env.BESOCCER_API_KEY ?? "").trim();
  if (legacy.startsWith("fapi_") && !PLACEHOLDER_KEYS.has(legacy.toLowerCase())) {
    return legacy;
  }
  return null;
}

export function getStatsApiKey(): string {
  const key = peekStatsApiKey();
  if (!key) throw new Error(STATS_API_KEY_NOT_CONFIGURED_MSG);
  return key;
}

export function isStatsApiConfigured(): boolean {
  return peekStatsApiKey() != null;
}

export function isStatsApiKeyError(msg: string): boolean {
  return /STATS_API_KEY|BESOCCER_API_KEY|not configured|KEY_REVOKED|inactive/i.test(
    msg
  );
}

export async function statsApiGet<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const key = getStatsApiKey();
  const base = getStatsApiBaseUrl();
  const url = new URL(
    path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`
  );
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${key}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(25_000),
      });
      const text = (await res.text()).trim();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }

      if (!res.ok) {
        const errObj =
          body && typeof body === "object" && "error" in (body as object)
            ? (body as { error?: { code?: string; message?: string } }).error
            : null;
        const code = errObj?.code ?? `HTTP_${res.status}`;
        const message = errObj?.message ?? text.slice(0, 200) ?? res.statusText;
        throw new Error(`${code}: ${message}`);
      }

      return body as T;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (/KEY_REVOKED|unauthorized|forbidden|401|403/i.test(lastError.message)) {
        break;
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      }
    }
  }
  throw new Error(
    `Stats API request failed for ${path}: ${lastError?.message}`
  );
}
