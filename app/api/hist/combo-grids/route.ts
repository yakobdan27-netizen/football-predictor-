import { NextResponse } from "next/server";
import {
  comboHistGridsForMatches,
  type ComboHistGridRequest,
} from "@/lib/hist/combo-samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST { matches: [{ matchId, homeTeam, awayTeam, league }] }
 * Returns hist-weighted score grids for Combined Odds when club samples are thin.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { matches?: ComboHistGridRequest[] };
    const matches = Array.isArray(body?.matches) ? body.matches : [];
    if (matches.length === 0) {
      return NextResponse.json({
        grids: {},
        sources: {},
        leagueBases: {},
        insufficient: [],
      });
    }
    const capped = matches.slice(0, 40);
    const result = await comboHistGridsForMatches(capped);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        grids: {},
        sources: {},
        leagueBases: {},
        insufficient: [],
      },
      { status: 500 }
    );
  }
}
