/**
 * API-Football subscription helpers (direct dashboard, not RapidAPI).
 */
import { apiFootballGet } from "./client";
import { normalizeFootballStatus } from "./status";

export const API_FOOTBALL_DASHBOARD_URL =
  "https://dashboard.api-football.com/";
export const API_FOOTBALL_PRICING_URL = "https://www.api-football.com/pricing";
/** Cheapest paid tier that fits this app's volume. */
export const API_FOOTBALL_RECOMMENDED_PLAN = "Pro";
export const API_FOOTBALL_RECOMMENDED_LIMIT_DAY = 7500;

export type ApiFootballPlanInfo = {
  plan: string;
  isFree: boolean;
  limitDay: number | null;
  remaining: number | null;
  current: number | null;
  subscriptionActive: boolean | null;
  subscriptionEnd: string | null;
  upgradeUrl: string;
  recommendedPlan: string;
};

type StatusPayload = {
  account?: { firstname?: string };
  subscription?: { plan?: string; end?: string; active?: boolean };
  requests?: { current?: number; limit_day?: number };
};

let cache: { at: number; info: ApiFootballPlanInfo } | null = null;
const CACHE_TTL_MS = 60_000;

export function isFreePlanName(plan: string | null | undefined): boolean {
  if (plan == null || !String(plan).trim()) return true;
  return /^free$/i.test(String(plan).trim());
}

function buildInfo(raw: unknown): ApiFootballPlanInfo {
  const normalized = normalizeFootballStatus(raw);
  const plan = normalized.plan ?? "Free";
  return {
    plan,
    isFree: isFreePlanName(plan),
    limitDay: normalized.requests?.limitDay ?? null,
    remaining: normalized.requests?.remaining ?? null,
    current: normalized.requests?.current ?? null,
    subscriptionActive: normalized.subscriptionActive ?? null,
    subscriptionEnd: normalized.subscriptionEnd ?? null,
    upgradeUrl: API_FOOTBALL_PRICING_URL,
    recommendedPlan: API_FOOTBALL_RECOMMENDED_PLAN,
  };
}

/** Cached /status plan snapshot. Treat unknown/errors as Free (safe defaults). */
export async function getApiFootballPlanInfo(
  force = false
): Promise<ApiFootballPlanInfo> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.info;
  }
  try {
    const raw = await apiFootballGet<StatusPayload>("/status");
    const info = buildInfo(raw);
    cache = { at: Date.now(), info };
    return info;
  } catch {
    const fallback: ApiFootballPlanInfo = {
      plan: "Free",
      isFree: true,
      limitDay: null,
      remaining: null,
      current: null,
      subscriptionActive: null,
      subscriptionEnd: null,
      upgradeUrl: API_FOOTBALL_PRICING_URL,
      recommendedPlan: API_FOOTBALL_RECOMMENDED_PLAN,
    };
    cache = { at: Date.now(), info: fallback };
    return fallback;
  }
}

export function clearApiFootballPlanCache(): void {
  cache = null;
}
