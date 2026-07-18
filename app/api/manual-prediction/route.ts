import { NextResponse } from "next/server";
import { getJson, setJson } from "@/lib/prediction-log/kv";

const LEARNING_LOG_KEY = "learner:manualPredictionLog";
const MAX_LOG = 200;

export interface ManualPredictionEntry {
  batchId: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  predictedScore?: string;
  actualScore?: string;
  confidence?: number;
  recordedAt: string;
}

/**
 * POST /api/manual-prediction
 * Audit log for settled manual picks. Primary learning still runs client-side
 * via updateLearnerStats() when batch results are saved (non-blocking).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ManualPredictionEntry>;
    if (!body.batchId || !body.matchId || !body.homeTeam || !body.awayTeam || !body.league) {
      return NextResponse.json(
        { error: "batchId, matchId, homeTeam, awayTeam, league required" },
        { status: 400 }
      );
    }

    const entry: ManualPredictionEntry = {
      batchId: body.batchId,
      matchId: body.matchId,
      homeTeam: body.homeTeam,
      awayTeam: body.awayTeam,
      league: body.league,
      predictedScore: body.predictedScore,
      actualScore: body.actualScore,
      confidence: body.confidence,
      recordedAt: new Date().toISOString(),
    };

    const existing = (await getJson<ManualPredictionEntry[]>(LEARNING_LOG_KEY)) ?? [];
    const next = [entry, ...existing].slice(0, MAX_LOG);
    await setJson(LEARNING_LOG_KEY, next);

    return NextResponse.json({
      ok: true,
      logged: next.length,
      note:
        "Logged for audit. Personal AI Learner updates from scored batches via updateLearnerStats (non-blocking).",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to record manual prediction";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
