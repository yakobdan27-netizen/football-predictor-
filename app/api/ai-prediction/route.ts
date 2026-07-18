import { NextResponse } from "next/server";
import {
  AI_ENHANCED_MIN_SAMPLES,
  getEnhancedMatchupPrediction,
} from "@/lib/prediction-log/ai-enhanced-prediction";
import type { LearnerStatsStore } from "@/lib/prediction-log/types";

/**
 * POST /api/ai-prediction
 * Body: { homeTeam, awayTeam, league, learnerStats? }
 * Returns reference or AI-enhanced matchup (enhancement needs ≥10 scored picks in learnerStats).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      homeTeam?: string;
      awayTeam?: string;
      league?: string;
      learnerStats?: LearnerStatsStore | null;
    };
    const homeTeam = body.homeTeam?.trim() ?? "";
    const awayTeam = body.awayTeam?.trim() ?? "";
    const league = body.league?.trim() ?? "Premier League";
    if (!homeTeam || !awayTeam) {
      return NextResponse.json({ error: "homeTeam and awayTeam required" }, { status: 400 });
    }

    const prediction = getEnhancedMatchupPrediction(
      homeTeam,
      awayTeam,
      league,
      body.learnerStats ?? null
    );
    if (!prediction) {
      return NextResponse.json(
        { error: "No seed baseline for this matchup" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ...prediction,
      enhancementThreshold: AI_ENHANCED_MIN_SAMPLES,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI prediction failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** GET convenience: reference-only (no learner stats on server). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const homeTeam = searchParams.get("homeTeam")?.trim() ?? "";
  const awayTeam = searchParams.get("awayTeam")?.trim() ?? "";
  const league = searchParams.get("league")?.trim() ?? "Premier League";
  if (!homeTeam || !awayTeam) {
    return NextResponse.json({ error: "homeTeam and awayTeam required" }, { status: 400 });
  }
  const prediction = getEnhancedMatchupPrediction(homeTeam, awayTeam, league, null);
  if (!prediction) {
    return NextResponse.json({ error: "No seed baseline for this matchup" }, { status: 404 });
  }
  return NextResponse.json({
    ...prediction,
    enhancementThreshold: AI_ENHANCED_MIN_SAMPLES,
  });
}
