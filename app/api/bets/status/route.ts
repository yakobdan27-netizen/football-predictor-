import { NextResponse } from "next/server";
import {
  apiFootballGet,
  getApiFootballKey,
  isApiFootballKeyError,
  API_KEY_NOT_CONFIGURED_MSG,
} from "@/lib/football-api/client";

export const runtime = "nodejs";
export const maxDuration = 15;

type StatusPayload = {
  account?: { firstname?: string };
  requests?: {
    current?: number;
    limit_day?: number;
    remaining?: number;
  };
};

export async function GET() {
  try {
    getApiFootballKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : API_KEY_NOT_CONFIGURED_MSG;
    return NextResponse.json({
      ok: false,
      configured: false,
      error: isApiFootballKeyError(msg) ? API_KEY_NOT_CONFIGURED_MSG : msg,
    });
  }

  try {
    const status = await apiFootballGet<StatusPayload>("/status");
    const req = status?.requests;
    return NextResponse.json({
      ok: true,
      configured: true,
      current: req?.current ?? null,
      limitDay: req?.limit_day ?? null,
      remaining:
        req?.remaining ??
        (req?.limit_day != null && req?.current != null
          ? Math.max(0, req.limit_day - req.current)
          : null),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Status check failed";
    return NextResponse.json({ ok: false, configured: true, error: msg });
  }
}
