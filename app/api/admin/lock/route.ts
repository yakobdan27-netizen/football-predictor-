import { NextResponse } from "next/server";
import { adminClearCookieOptions } from "@/lib/admin/auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(adminClearCookieOptions());
  return res;
}
