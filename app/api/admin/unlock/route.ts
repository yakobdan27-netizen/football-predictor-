import { NextResponse } from "next/server";
import {
  adminSessionToken,
  adminUnlockCookieOptions,
  getAdminSecret,
  secretsEqual,
} from "@/lib/admin/auth";

export async function POST(request: Request) {
  const secret = getAdminSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "ADMIN_SECRET is not configured" },
      { status: 503 }
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
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  const token = adminSessionToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(adminUnlockCookieOptions(token));
  return res;
}
