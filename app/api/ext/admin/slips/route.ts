import { NextResponse } from "next/server";
import { requireAdminSlipsSlug } from "@/lib/ext-bets/admin-auth";
import {
  adminSummary,
  listAllExtSlipsForAdmin,
  voidExtSlip,
} from "@/lib/ext-bets/store";
import { settleAllExtOpenFinished } from "@/lib/ext-bets/settle";
import { ensureBetSettlementRegistered } from "@/lib/bets/register-settlement";

export const runtime = "nodejs";
export const maxDuration = 60;

ensureBetSettlementRegistered();

export async function GET(request: Request) {
  const denied = requireAdminSlipsSlug(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const phone = url.searchParams.get("phone") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;
    const leagueIdRaw = url.searchParams.get("leagueId");
    const leagueId =
      leagueIdRaw != null && leagueIdRaw !== ""
        ? Number.parseInt(leagueIdRaw, 10)
        : undefined;
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");

    const rows = await listAllExtSlipsForAdmin({
      phone,
      status: status || undefined,
      leagueId: Number.isFinite(leagueId) ? leagueId : undefined,
      from: fromRaw ? new Date(fromRaw) : undefined,
      to: toRaw ? new Date(toRaw) : undefined,
    });
    const summary = await adminSummary();

    return NextResponse.json({
      ok: true,
      summary,
      slips: rows.map(({ slip, user, selections }) => ({
        id: slip.id,
        phone: user.phone,
        displayName: user.displayName,
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

export async function POST(request: Request) {
  const denied = requireAdminSlipsSlug(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as {
      action?: "void" | "settle";
      slipId?: number;
    };

    if (body.action === "settle") {
      const r = await settleAllExtOpenFinished();
      return NextResponse.json({ ok: true, ...r });
    }

    if (body.action === "void") {
      if (!body.slipId) {
        return NextResponse.json(
          { ok: false, error: "slipId required" },
          { status: 400 }
        );
      }
      const row = await voidExtSlip(body.slipId);
      if (!row) {
        return NextResponse.json(
          { ok: false, error: "Slip not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, slipId: row.id, status: row.status });
    }

    return NextResponse.json(
      { ok: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
