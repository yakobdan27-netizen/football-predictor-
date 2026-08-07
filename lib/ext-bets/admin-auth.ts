import { NextResponse } from "next/server";

export function getAdminSlipsSlug(): string | null {
  const s = (process.env.ADMIN_SLIPS_SLUG ?? "").trim();
  return s || null;
}

export function getAdminUsersSlug(): string | null {
  const s = (process.env.ADMIN_USERS_SLUG ?? "").trim();
  return s || null;
}

function requireSlug(
  request: Request,
  expected: string | null,
  headerName: string,
  envName: string
): NextResponse | null {
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: `${envName} not configured` },
      { status: 503 }
    );
  }
  const header = request.headers.get(headerName)?.trim() ?? "";
  const url = new URL(request.url);
  const q = url.searchParams.get("slug")?.trim() ?? "";
  const got = header || q;
  if (got !== expected) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** Authorize admin-slips APIs via slug header or query — not ADMIN_SECRET. */
export function requireAdminSlipsSlug(
  request: Request
): NextResponse | null {
  return requireSlug(
    request,
    getAdminSlipsSlug(),
    "x-admin-slips-slug",
    "ADMIN_SLIPS_SLUG"
  );
}

/** Authorize admin-users APIs via slug header or query — not ADMIN_SECRET. */
export function requireAdminUsersSlug(
  request: Request
): NextResponse | null {
  return requireSlug(
    request,
    getAdminUsersSlug(),
    "x-admin-users-slug",
    "ADMIN_USERS_SLUG"
  );
}
