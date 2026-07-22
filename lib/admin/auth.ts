import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const ADMIN_COOKIE = "fp_admin_session";
export const ADMIN_SECRET_HEADER = "x-admin-secret";
/** Exact startup / missing-config message (no secret echo). */
export const ADMIN_SECRET_MISSING_MSG =
  "Set ADMIN_SECRET in the environment, then reload.";
export const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours
export const UNLOCK_RATE_LIMIT_PER_MINUTE = 5;

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

export function headerAdminSecret(request: Request): string | null {
  const raw = request.headers.get(ADMIN_SECRET_HEADER);
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

export function isAuthorizedByHeader(request: Request): boolean {
  const secret = getAdminSecret();
  const provided = headerAdminSecret(request);
  if (!secret || !provided) return false;
  return secretsEqual(provided, secret);
}

/**
 * For Route Handlers: 401/503 or null if OK.
 * Accepts `x-admin-secret` header or valid session cookie.
 */
export async function requireAdminRequest(
  request?: Request
): Promise<NextResponse | null> {
  const secret = getAdminSecret();
  if (!secret) {
    return NextResponse.json(
      { error: ADMIN_SECRET_MISSING_MSG },
      { status: 503 }
    );
  }
  if (request && isAuthorizedByHeader(request)) {
    return null;
  }
  if (await readAdminSessionFromCookies()) {
    return null;
  }
  return NextResponse.json(
    { error: "Admin authentication required" },
    { status: 401 }
  );
}

export function adminUnlockCookieOptions(token: string) {
  return {
    name: ADMIN_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

export function adminClearCookieOptions() {
  return {
    name: ADMIN_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 0,
  };
}

export function clientIpFromRequest(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
