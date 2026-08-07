import { NextResponse } from "next/server";
import { requireAdminUsersSlug } from "@/lib/ext-bets/admin-auth";
import { listExtUsersForAdmin } from "@/lib/ext-bets/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = requireAdminUsersSlug(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? undefined;
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const minSlipsRaw = url.searchParams.get("minSlips");
    const minSlips =
      minSlipsRaw != null && minSlipsRaw !== ""
        ? Number.parseInt(minSlipsRaw, 10)
        : undefined;

    const users = await listExtUsersForAdmin({
      q,
      from: fromRaw ? new Date(fromRaw) : undefined,
      to: toRaw ? new Date(toRaw) : undefined,
      minSlipCount: Number.isFinite(minSlips) ? minSlips : undefined,
    });

    const summary = {
      totalUsers: users.length,
      totalSlips: users.reduce((n, u) => n + u.totalSlips, 0),
      open: users.reduce((n, u) => n + u.submitted, 0),
      won: users.reduce((n, u) => n + u.won, 0),
      lost: users.reduce((n, u) => n + u.lost, 0),
    };

    return NextResponse.json({
      ok: true,
      summary,
      users: users.map((u) => ({
        id: u.id,
        phone: u.phone,
        displayName: u.displayName,
        firstSeenAt: u.firstSeenAt.toISOString(),
        lastSeenAt: u.lastSeenAt.toISOString(),
        totalSlips: u.totalSlips,
        submitted: u.submitted,
        won: u.won,
        lost: u.lost,
        voided: u.voided,
        netResult: u.netResult,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
