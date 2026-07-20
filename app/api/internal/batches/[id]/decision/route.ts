import { NextResponse } from "next/server";
import { requireInternalApiKey } from "@/lib/telegram/internal-auth";
import { OwnershipError } from "@/lib/telegram/ownership";
import { runDecisionForOwnedBatch } from "@/lib/telegram/decision-service";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = requireInternalApiKey(request);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const url = new URL(request.url);
    const ownerUserId = url.searchParams.get("ownerUserId")?.trim();
    if (!ownerUserId) {
      return NextResponse.json({ error: "ownerUserId required" }, { status: 400 });
    }

    const result = await runDecisionForOwnedBatch(id, ownerUserId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof OwnershipError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    const status = (e as Error & { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Decision failed" },
      { status }
    );
  }
}
