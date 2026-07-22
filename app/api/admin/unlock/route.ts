import { NextResponse } from "next/server";
import {
  ADMIN_SECRET_MISSING_MSG,
  UNLOCK_RATE_LIMIT_PER_MINUTE,
  adminSessionToken,
  adminUnlockCookieOptions,
  clientIpFromRequest,
  getAdminSecret,
  secretsEqual,
} from "@/lib/admin/auth";
import { KV_KEYS } from "@/lib/prediction-log/kv-keys";
import { getJson, setJsonEx } from "@/lib/prediction-log/kv";

async function bumpUnlockFailures(ip: string): Promise<number> {
  const minute = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const key = KV_KEYS.adminUnlockRateLimit(ip, minute);
  const count = ((await getJson<number>(key)) ?? 0) + 1;
  await setJsonEx(key, count, 120);
  return count;
}

async function readUnlockFailures(ip: string): Promise<number> {
  const minute = new Date().toISOString().slice(0, 16);
  const key = KV_KEYS.adminUnlockRateLimit(ip, minute);
  return (await getJson<number>(key)) ?? 0;
}

export async function POST(request: Request) {
  const secret = getAdminSecret();
  if (!secret) {
    return NextResponse.json(
      { error: ADMIN_SECRET_MISSING_MSG },
      { status: 503 }
    );
  }

  const ip = clientIpFromRequest(request);
  const prior = await readUnlockFailures(ip);
  if (prior >= UNLOCK_RATE_LIMIT_PER_MINUTE) {
    console.warn("admin unlock rate limited", { ip });
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429 }
    );
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const password = (body.password ?? "").trim();
  if (!password || !secretsEqual(password, secret)) {
    const failures = await bumpUnlockFailures(ip);
    console.warn("admin unlock failed", { ip, failures });
    return NextResponse.json(
      { error: "Admin authentication required" },
      { status: 401 }
    );
  }

  const token = adminSessionToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(adminUnlockCookieOptions(token));
  return res;
}
