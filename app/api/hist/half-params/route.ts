import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db/init";
import {
  loadHalfParamsStore,
  setCachedHalfParams,
} from "@/lib/hist/half-params";

export const runtime = "nodejs";

/** GET — fitted half-share / κ params for client CFE cache. */
export async function GET() {
  try {
    await ensureSchema();
    const store = await loadHalfParamsStore();
    setCachedHalfParams(store);
    return NextResponse.json({ ok: true, store });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
