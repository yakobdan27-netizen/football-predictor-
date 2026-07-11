import { NextResponse } from "next/server";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import {
  runRecoBacktest,
  type RecoBacktestConfig,
  type RecoBacktestMode,
} from "@/lib/prediction-log/backtest-engine";
import {
  listBacktestRuns,
  loadBacktestRun,
  saveBacktestRun,
} from "@/lib/prediction-log/backtest-store";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { loadMlClassifier } from "@/lib/prediction-log/ml-model-store";

export const maxDuration = 60;

const MODES: RecoBacktestMode[] = [
  "full",
  "rolling_3",
  "rolling_6",
  "rolling_12",
  "custom",
];

function parseConfig(body: unknown): RecoBacktestConfig {
  const b = (body ?? {}) as Record<string, unknown>;
  const mode = (typeof b.mode === "string" ? b.mode : "full") as RecoBacktestMode;
  if (!MODES.includes(mode)) {
    throw new Error(`Invalid mode. Use one of: ${MODES.join(", ")}`);
  }
  const leagues = Array.isArray(b.leagues)
    ? b.leagues.filter((x): x is string => typeof x === "string")
    : undefined;
  return {
    mode,
    leagues,
    dateFrom: typeof b.dateFrom === "string" ? b.dateFrom : undefined,
    dateTo: typeof b.dateTo === "string" ? b.dateTo : undefined,
    warnAbove: typeof b.warnAbove === "number" ? b.warnAbove : undefined,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const run = await loadBacktestRun(id);
      if (!run) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      return NextResponse.json({ run });
    }
    const runs = await listBacktestRuns();
    return NextResponse.json({ runs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load backtest runs";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const config = parseConfig(body);
    const batches = await loadAllBatches();
    if (!batches.length) {
      return NextResponse.json(
        { error: "No prediction batches found. Log results first." },
        { status: 400 }
      );
    }

    const [teamsQuality, mlClassifier] = await Promise.all([
      loadTeamsQualityStore().catch(() => null),
      loadMlClassifier().catch(() => null),
    ]);

    const result = runRecoBacktest({
      batches,
      config,
      teamsQuality,
      mlClassifier,
    });

    if (result.summary.nMatches === 0) {
      return NextResponse.json(
        {
          error:
            "No settled matches in the selected window. Need FT goals on batch matches.",
        },
        { status: 400 }
      );
    }

    await saveBacktestRun(result);
    return NextResponse.json({ run: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Reco backtest failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
