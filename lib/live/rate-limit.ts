let backoffUntilMs = 0;
let lastRemaining: number | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function getLastQuotaRemaining(): number | null {
  return lastRemaining;
}

export function noteRateLimitHeaders(headers: Headers): void {
  const rem =
    headers.get("x-ratelimit-requests-remaining") ??
    headers.get("x-ratelimit-remaining");
  if (rem != null && rem !== "") {
    const n = Number(rem);
    if (Number.isFinite(n)) lastRemaining = n;
  }
}

export function isRateLimitedNow(): boolean {
  return Date.now() < backoffUntilMs;
}

/** Call after HTTP 429 — exponential backoff capped at 5 minutes. */
export async function backoffOn429(attempt: number): Promise<void> {
  const ms = Math.min(5 * 60_000, 2 ** attempt * 1000);
  backoffUntilMs = Date.now() + ms;
  console.warn(
    `[live] rate limited; backing off ${ms}ms` +
      (lastRemaining != null ? ` (remaining≈${lastRemaining})` : "")
  );
  await sleep(ms);
}

export async function waitIfRateLimited(): Promise<void> {
  const wait = backoffUntilMs - Date.now();
  if (wait > 0) await sleep(wait);
}
