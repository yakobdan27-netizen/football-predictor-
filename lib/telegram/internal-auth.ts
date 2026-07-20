import { NextResponse } from "next/server";

export function requireInternalApiKey(request: Request): NextResponse | null {
  const expected = (process.env.INTERNAL_API_KEY ?? "").trim();
  if (!expected) {
    return NextResponse.json(
      { error: "INTERNAL_API_KEY is not configured" },
      { status: 503 }
    );
  }
  const got = (request.headers.get("x-internal-api-key") ?? "").trim();
  if (!got || got !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
