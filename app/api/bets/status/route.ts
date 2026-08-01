import { NextResponse } from "next/server";
import {
  getApiFootballKey,
  isApiFootballKeyError,
  API_KEY_NOT_CONFIGURED_MSG,
} from "@/lib/football-api/client";
import {
  API_FOOTBALL_PRICING_URL,
  API_FOOTBALL_RECOMMENDED_LIMIT_DAY,
  API_FOOTBALL_RECOMMENDED_PLAN,
  getApiFootballPlanInfo,
} from "@/lib/football-api/plan";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET() {
  try {
    getApiFootballKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : API_KEY_NOT_CONFIGURED_MSG;
    return NextResponse.json({
      ok: false,
      configured: false,
      error: isApiFootballKeyError(msg) ? API_KEY_NOT_CONFIGURED_MSG : msg,
      upgradeUrl: API_FOOTBALL_PRICING_URL,
      recommendedPlan: API_FOOTBALL_RECOMMENDED_PLAN,
      recommendedLimitDay: API_FOOTBALL_RECOMMENDED_LIMIT_DAY,
    });
  }

  try {
    const plan = await getApiFootballPlanInfo(true);
    return NextResponse.json({
      ok: true,
      configured: true,
      plan: plan.plan,
      isFree: plan.isFree,
      current: plan.current,
      limitDay: plan.limitDay,
      remaining: plan.remaining,
      subscriptionActive: plan.subscriptionActive,
      subscriptionEnd: plan.subscriptionEnd,
      upgradeUrl: plan.upgradeUrl,
      recommendedPlan: plan.recommendedPlan,
      recommendedLimitDay: API_FOOTBALL_RECOMMENDED_LIMIT_DAY,
      needsUpgrade: plan.isFree || (plan.limitDay != null && plan.limitDay < 1000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Status check failed";
    return NextResponse.json({
      ok: false,
      configured: true,
      error: msg,
      upgradeUrl: API_FOOTBALL_PRICING_URL,
      recommendedPlan: API_FOOTBALL_RECOMMENDED_PLAN,
      recommendedLimitDay: API_FOOTBALL_RECOMMENDED_LIMIT_DAY,
    });
  }
}
