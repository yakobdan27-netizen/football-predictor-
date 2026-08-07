import { NextResponse } from "next/server";
import { requireAdminUsersSlug } from "@/lib/ext-bets/admin-auth";
import { getExtUserAdminDetail } from "@/lib/ext-bets/store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAdminUsersSlug(request);
  if (denied) return denied;

  try {
    const { id: idRaw } = await params;
    const userId = Number.parseInt(idRaw, 10);
    if (!Number.isFinite(userId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid user id" },
        { status: 400 }
      );
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");

    const detail = await getExtUserAdminDetail(userId, {
      status: status || undefined,
      from: fromRaw ? new Date(fromRaw) : undefined,
      to: toRaw ? new Date(toRaw) : undefined,
    });

    if (!detail) {
      return NextResponse.json(
        { ok: false, error: "User not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: detail.user.id,
        phone: detail.user.phone,
        displayName: detail.user.displayName,
        firstSeenAt: detail.user.firstSeenAt.toISOString(),
        lastSeenAt: detail.user.lastSeenAt.toISOString(),
      },
      stats: detail.stats,
      slips: detail.slips.map(({ slip, selections }) => ({
        id: slip.id,
        createdAt: slip.createdAt.toISOString(),
        slipType: slip.slipType,
        stake: slip.stake,
        totalOdd: slip.totalOdd,
        potentialReturn: slip.potentialReturn,
        status: slip.status,
        note: slip.note,
        selections: selections.map((s) => ({
          id: s.id,
          eventLabel: s.eventLabel,
          marketLabel: s.marketLabel,
          chosenLabel: s.chosenLabel,
          chosenOdd: s.chosenOdd,
          result: s.result,
        })),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
