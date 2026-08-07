import { NextResponse } from "next/server";

export function getAdminSlipsSlug(): string | null {
  const s = (process.env.ADMIN_SLIPS_SLUG ?? "").trim();
  return s || null;
}

/** Authorize admin-slips APIs via slug header or query — not ADMIN_SECRET. */
export function requireAdminSlipsSlug(
  request: Request
): NextResponse | null {
  const expected = getAdminSlipsSlug();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "ADMIN_SLIPS_SLUG not configured" },
      { status: 503 }
    );
  }
  const header = request.headers.get("x-admin-slips-slug")?.trim() ?? "";
  const url = new URL(request.url);
  const q = url.searchParams.get("slug")?.trim() ?? "";
  const got = header || q;
  if (got !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
