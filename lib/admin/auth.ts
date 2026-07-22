import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const ADMIN_COOKIE = "fp_admin_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export function getAdminSecret(): string | null {
  const s = (process.env.ADMIN_SECRET ?? "").trim();
  return s || null;
}

/** Opaque session token derived from ADMIN_SECRET (never store the raw secret). */
export function adminSessionToken(secret: string): string {
  return createHash("sha256").update(`fp-admin:${secret}`).digest("hex");
}

export function tokensMatch(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Constant-time compare of two secrets (any length). */
export function secretsEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function isValidAdminToken(token: string | undefined | null): boolean {
  const secret = getAdminSecret();
  if (!secret || !token) return false;
  return tokensMatch(token, adminSessionToken(secret));
}

export async function readAdminSessionFromCookies(): Promise<boolean> {
  const jar = await cookies();
  return isValidAdminToken(jar.get(ADMIN_COOKIE)?.value);
}

/** For Route Handlers: 401/503 or null if OK. */
export async function requireAdminRequest(): Promise<NextResponse | null> {
  const secret = getAdminSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_SECRET is not configured" },
      { status: 503 }
    );
  }
  if (!(await readAdminSessionFromCookies())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export function adminUnlockCookieOptions(token: string) {
  return {
    name: ADMIN_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  };
}

export function adminClearCookieOptions() {
  return {
    name: ADMIN_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}
