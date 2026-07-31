import { NextResponse } from "next/server";
import {
  createMultiSlip,
  createSingleSlips,
  getMarketById,
  listSlipsByStatus,
} from "@/lib/bets/store";
import { provisionalStatus } from "@/lib/bets/provisional";
import { ensureBetSettlementRegistered } from "@/lib/bets/register-settlement";
import { getFixtureById } from "@/lib/live/store";

export const runtime = "nodejs";
export const maxDuration = 30;

type PlaceBody = {
  slipType?: "SINGLE" | "MULTI";
  stake?: number;
  selections?: Array<{
    betEventId: number;
    marketId: number;
    chosenLabel: string;
    chosenOdd: number;
    stake?: number;
  }>;
};

export async function GET(request: Request) {
  ensureBetSettlementRegistered();
  try {
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") ?? "OPEN").toUpperCase();
    const group = status === "OPEN" ? "OPEN" : "SETTLED";
    const slips = await listSlipsByStatus(group);

    const enriched = await Promise.all(
      slips.map(async (slip) => ({
        ...slip,
        selections: await Promise.all(
          slip.selections.map(async (sel) => {
            const live = sel.event
              ? await getFixtureById(sel.event.apiFixtureId).catch(() => null)
              : null;
            const provisional = sel.market
              ? provisionalStatus(sel.market.marketType, sel.chosenLabel, {
                  homeGoals: live?.homeGoals ?? sel.event?.homeScore ?? null,
                  awayGoals: live?.awayGoals ?? sel.event?.awayScore ?? null,
                  status: live?.status ?? sel.event?.status ?? "NS",
                  minute: live?.statusMinute ?? sel.event?.minute ?? null,
                })
              : "undecided";
            return {
              ...sel,
              liveScore: live
                ? {
                    home: live.homeGoals,
                    away: live.awayGoals,
                    status: live.status,
                    minute: live.statusMinute,
                  }
                : null,
              provisional,
            };
          })
        ),
      }))
    );

    return NextResponse.json({ ok: true, status: group, slips: enriched });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "List slips failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  ensureBetSettlementRegistered();
  try {
    const body = (await request.json()) as PlaceBody;
    const slipType = body.slipType === "MULTI" ? "MULTI" : "SINGLE";
    const selections = body.selections ?? [];
    if (!selections.length) {
      return NextResponse.json(
        { ok: false, error: "selections required" },
        { status: 400 }
      );
    }

    // Validate odds — never invent; require a numeric chosenOdd > 1
    for (const s of selections) {
      if (!Number.isFinite(s.chosenOdd) || s.chosenOdd <= 1) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Each selection needs a valid odd (>1). Enter MANUAL odds if API odds are missing.",
          },
          { status: 400 }
        );
      }
      const market = await getMarketById(s.marketId);
      if (!market) {
        return NextResponse.json(
          { ok: false, error: `Market ${s.marketId} not found` },
          { status: 400 }
        );
      }
    }

    if (slipType === "SINGLE") {
      const slips = await createSingleSlips(
        selections.map((s) => ({
          betEventId: s.betEventId,
          marketId: s.marketId,
          chosenLabel: s.chosenLabel,
          chosenOdd: s.chosenOdd,
          stake: Number(s.stake ?? body.stake ?? 0) || 0,
        }))
      );
      return NextResponse.json({
        ok: true,
        slipType,
        slips,
        count: slips.length,
      });
    }

    const stake = Number(body.stake ?? 0) || 0;
    const slip = await createMultiSlip(
      selections.map((s) => ({
        betEventId: s.betEventId,
        marketId: s.marketId,
        chosenLabel: s.chosenLabel,
        chosenOdd: s.chosenOdd,
      })),
      stake
    );
    return NextResponse.json({ ok: true, slipType, slips: [slip], count: 1 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Place slip failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
