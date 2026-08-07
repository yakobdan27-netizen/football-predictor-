import { NextResponse } from "next/server";
import {
  createExtSlip,
  getExtUserById,
  listExtSlipsForUser,
} from "@/lib/ext-bets/store";
import { ensureBetSettlementRegistered } from "@/lib/bets/register-settlement";

export const runtime = "nodejs";
export const maxDuration = 60;

ensureBetSettlementRegistered();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = Number.parseInt(url.searchParams.get("userId") ?? "", 10);
    if (!Number.isFinite(userId)) {
      return NextResponse.json(
        { ok: false, error: "userId required" },
        { status: 400 }
      );
    }
    const user = await getExtUserById(userId);
    if (!user) {
      return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
    }
    const rows = await listExtSlipsForUser(userId);
    return NextResponse.json({
      ok: true,
      phone: user.phone,
      slips: rows.map(({ slip, selections }) => ({
        id: slip.id,
        slipType: slip.slipType,
        stake: slip.stake,
        totalOdd: slip.totalOdd,
        potentialReturn: slip.potentialReturn,
        status: slip.status,
        createdAt: slip.createdAt.toISOString(),
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
  try {
    const body = (await request.json()) as {
      userId?: number;
      slipType?: "SINGLE" | "MULTI";
      stake?: number;
      note?: string;
      selections?: Array<{
        betEventId: number;
        marketId: number;
        chosenLabel: string;
        chosenOdd: number;
        stake?: number;
        eventLabel?: string;
        marketLabel?: string;
      }>;
    };

    const userId = body.userId;
    if (!userId || !(await getExtUserById(userId))) {
      return NextResponse.json(
        { ok: false, error: "Valid userId required" },
        { status: 400 }
      );
    }
    const selections = body.selections ?? [];
    if (!selections.length) {
      return NextResponse.json(
        { ok: false, error: "selections required" },
        { status: 400 }
      );
    }

    const slipType = body.slipType === "SINGLE" ? "SINGLE" : "MULTI";
    const created = [];

    if (slipType === "SINGLE") {
      for (const sel of selections) {
        const stake = sel.stake ?? body.stake ?? 0;
        const { slip, selections: sels } = await createExtSlip({
          extUserId: userId,
          slipType: "SINGLE",
          stake,
          note: body.note,
          selections: [sel],
        });
        created.push({ slip, selections: sels });
      }
    } else {
      const stake = body.stake ?? 0;
      const { slip, selections: sels } = await createExtSlip({
        extUserId: userId,
        slipType: "MULTI",
        stake,
        note: body.note,
        selections,
      });
      created.push({ slip, selections: sels });
    }

    return NextResponse.json({
      ok: true,
      count: created.length,
      slips: created.map(({ slip, selections: sels }) => ({
        id: slip.id,
        stake: slip.stake,
        totalOdd: slip.totalOdd,
        potentialReturn: slip.potentialReturn,
        status: slip.status,
        selections: sels.map((s) => ({
          eventLabel: s.eventLabel,
          marketLabel: s.marketLabel,
          chosenLabel: s.chosenLabel,
          chosenOdd: s.chosenOdd,
        })),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
