/**
 * Normalize api-sports /status payload for admin diagnostics.
 * Only maps fields that exist — never invents numbers.
 */
export interface FootballStatusNormalized {
  ok: boolean;
  account?: {
    firstname?: string;
    lastname?: string;
    email?: string;
  };
  plan?: string;
  subscriptionActive?: boolean;
  subscriptionEnd?: string;
  requests?: {
    current?: number;
    limitDay?: number;
    remaining?: number;
  };
  /** Raw upstream response for debugging. */
  raw?: unknown;
  error?: string;
}

type UpstreamStatus = {
  account?: {
    firstname?: string;
    lastname?: string;
    email?: string;
  };
  subscription?: {
    plan?: string;
    end?: string;
    active?: boolean;
  };
  requests?: {
    current?: number;
    limit_day?: number;
  };
};

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function normalizeFootballStatus(
  raw: unknown
): Omit<FootballStatusNormalized, "ok" | "error"> {
  const s = (raw ?? {}) as UpstreamStatus;
  const current = asNumber(s.requests?.current);
  const limitDay = asNumber(s.requests?.limit_day);
  const remaining =
    current != null && limitDay != null ? Math.max(0, limitDay - current) : undefined;

  return {
    account: s.account
      ? {
          firstname: s.account.firstname,
          lastname: s.account.lastname,
          email: s.account.email,
        }
      : undefined,
    plan: s.subscription?.plan,
    subscriptionActive: s.subscription?.active,
    subscriptionEnd: s.subscription?.end,
    requests:
      current != null || limitDay != null
        ? { current, limitDay, remaining }
        : undefined,
    raw,
  };
}
