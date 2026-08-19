import { NextResponse } from "next/server";
import { executeAndSerialize } from "@/lib/market-advisory/run-for-fixture";
import { snapshotDecisionMakerEms } from "@/lib/market-advisory/ems-adapters/decision-maker";
import { snapshotWeekendPicksEms } from "@/lib/market-advisory/ems-adapters/weekend-picks";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import type { ScoredDecisionMarket } from "@/lib/prediction-log/decision-maker/types";
import type { BestMarketPick } from "@/lib/match-centre/weekend-opportunities";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { recomputeAnalysis } from "@/lib/prediction-log/analysis";

export const runtime = "nodejs";

type RunBody = {
  fixtureId: number;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffIso?: string;
  emsKind: "decision_maker" | "weekend_picks";
  cfe: CanonicalFixtureEstimate;
  emsMarkets?: ScoredDecisionMarket[];
  weekendPick?: BestMarketPick;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RunBody;
    if (!body.fixtureId || !body.cfe || !body.emsKind) {
      return NextResponse.json(
        { ok: false, error: "fixtureId, cfe, and emsKind required" },
        { status: 400 }
      );
    }

    const allBatches = await loadAllBatches();
    const analysis = recomputeAnalysis(allBatches);

    const emsSnapshot =
      body.emsKind === "decision_maker"
        ? snapshotDecisionMakerEms(body.emsMarkets ?? [])
        : snapshotWeekendPicksEms(body.weekendPick ?? null);

    const { result, ui } = executeAndSerialize({
      fixtureId: body.fixtureId,
      matchId: body.matchId,
      homeTeam: body.homeTeam,
      awayTeam: body.awayTeam,
      league: body.league,
      kickoffIso: body.kickoffIso,
      cfe: body.cfe,
      emsSnapshot,
      emsKind: body.emsKind,
      allBatches,
      analysis,
    });

    return NextResponse.json({ ok: true, result, advisory: ui });
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
