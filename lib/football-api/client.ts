const DEFAULT_API_BASE = "https://v3.football.api-sports.io";

export function getApiFootballBaseUrl(): string {
  const raw = (process.env.API_FOOTBALL_BASE_URL ?? "").trim().replace(/\/$/, "");
  return raw || DEFAULT_API_BASE;
}

export function getApiFootballKey(): string {
  const key = (process.env.API_FOOTBALL_KEY ?? "").trim();
  if (!key || key.toLowerCase() === "your_api_key_here") {
    throw new Error("API_FOOTBALL_KEY is not configured");
  }
  return key;
}

export interface ApiFootballResponse<T> {
  get?: string;
  parameters?: Record<string, string>;
  errors?: Record<string, string> | string[];
  results?: number;
  paging?: { current: number; total: number };
  response: T;
}

export async function apiFootballGet<T>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const key = getApiFootballKey();
  const base = getApiFootballBaseUrl();
  const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.append(k, String(v));
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          // Direct api-sports service (NOT RapidAPI)
          "x-apisports-key": key,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const payload = (await res.json()) as ApiFootballResponse<T>;
      if (payload.errors) {
        const msg =
          typeof payload.errors === "object" && !Array.isArray(payload.errors)
            ? JSON.stringify(payload.errors)
            : String(payload.errors);
        if (msg && msg !== "{}" && msg !== "[]") {
          throw new Error(`API errors: ${msg}`);
        }
      }
      return payload.response;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      }
    }
  }
  throw new Error(`API request failed for ${path}: ${lastError?.message}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
