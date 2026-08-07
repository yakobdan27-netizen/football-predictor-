import { NextResponse } from "next/server";
import { upsertExtUser } from "@/lib/ext-bets/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      phone?: string;
      displayName?: string;
    };
    if (!body.phone?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Phone or access code required" },
        { status: 400 }
      );
    }
    const user = await upsertExtUser({
      phone: body.phone,
      displayName: body.displayName,
    });
    return NextResponse.json({
      ok: true,
      userId: user.id,
      phone: user.phone,
      displayName: user.displayName,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
