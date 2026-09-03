/**
 * OpenAI weekend predictor — context from CFE + learner stats, 30 picks from pool.
 */
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  openaiWeekendPredictionRuns,
  openaiWeekendPredictions,
} from "@/lib/db/schema";
import {
  buildWeekendPool,
  estimatesByFixtureId,
  sliceTopWeekendRows,
} from "@/lib/match-centre/build-weekend-pool";
import type { WeekendOpportunityRow } from "@/lib/match-centre/weekend-opportunities";
import { WEEKEND_EXCLUDED_FAMILIES } from "@/lib/match-centre/weekend-opportunities";
import { getOpenAiClient, openAiModel } from "@/lib/openai/client";
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";
import { scoreComboLeg } from "@/lib/prediction-log/combo-scoring";
import { deriveActualsFromFacts } from "@/lib/prediction-log/grade-from-facts";
import { overallWinRate } from "@/lib/prediction-log/learner-patterns";
import { scoreMarket } from "@/lib/prediction-log/score-market";
import type {
  LearnerStatsStore,
  LogMarketKey,
  LogMatch,
  MarketReliabilityEntry,
  ScoreResult,
} from "@/lib/prediction-log/types";
import { getFixtureById } from "@/lib/live/store";
import { FAMILY_LABELS } from "@/lib/slip-builder/families";
import { MARKET_FAMILY_IDS, type MarketFamilyId } from "@/lib/slip-builder/types";

export const OPENAI_PROMPT_VERSION = "v1";

const ALLOWED_FAMILIES = MARKET_FAMILY_IDS.filter(
  (f) => !(WEEKEND_EXCLUDED_FAMILIES as readonly string[]).includes(f)
);

export type OpenAiPickDraft = {
  apiFixtureId: number;
  marketFamily: string;
  marketLabel: string;
  selectionKey: string;
  line?: number | null;
  comboId?: string | null;
  prediction: string;
  confidencePct: number;
  rationale: string;
};

export type OpenAiWeekendPick = OpenAiPickDraft & {
  id: number;
  runId: number;
  weekendBatchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffIso: string;
  systemMarket: string | null;
  systemPrediction: string | null;
  systemProbabilityPct: number | null;
  result: string | null;
  gradedAt: string | null;
};

export type OpenAiContextSummary = {
  learnerWinRate: number | null;
  learnerScoredPicks: number;
  topReliableRanges: string[];
  weakRanges: string[];
  cautiousClubs: string[];
  topTeamMarkets: string[];
  openAiHistoricalByFamily: Array<{
    marketFamily: string;
    wins: number;
    losses: number;
    winRate: number | null;
  }>;
};

export type OpenAiWeekendRunResult = {
  runId: number;
  weekendBatchId: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
  matchCount: number;
  summary: OpenAiContextSummary;
  picks: OpenAiWeekendPick[];
};

function estimateKey(apiFixtureId: number): string {
  return `api:${apiFixtureId}`;
}

function pctFromProb(p: number | null | undefined): number | null {
  if (p == null || !Number.isFinite(p)) return null;
  return Math.round(p * 1000) / 10;
}

export function buildOpenAiContext(input: {
  rows: WeekendOpportunityRow[];
  estimates: Record<string, CanonicalFixtureEstimate>;
  learnerStats: LearnerStatsStore;
  reliabilityEntries: MarketReliabilityEntry[];
  historicalByFamily: OpenAiContextSummary["openAiHistoricalByFamily"];
}): { summary: OpenAiContextSummary; matches: unknown[] } {
  const { rows, estimates, learnerStats, reliabilityEntries, historicalByFamily } =
    input;

  const topReliability = [...reliabilityEntries]
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
    .slice(0, 10)
    .map(
      (r) =>
        `${r.team} (${r.league}): ${r.marketFamily} ${r.selection} ${r.winRate ?? "?"}% (${r.sample}n)`
    );

  const summary: OpenAiContextSummary = {
    learnerWinRate: overallWinRate(learnerStats),
    learnerScoredPicks: learnerStats.totalScoredPicks,
    topReliableRanges: learnerStats.topReliableRanges ?? [],
    weakRanges: learnerStats.weakestRanges ?? [],
    cautiousClubs: (learnerStats.cautiousClubs ?? [])
      .slice(0, 12)
      .map((c) => c.clubName),
    topTeamMarkets: topReliability,
    openAiHistoricalByFamily: historicalByFamily,
  };

  const matches = rows.map((row) => {
    const est = estimates[estimateKey(row.apiFixtureId)];
    const m = est?.markets;
    return {
      apiFixtureId: row.apiFixtureId,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      league: row.league,
      kickoffIso: row.kickoffIso,
      systemPick: {
        marketLabel: row.marketLabel,
        prediction: row.prediction,
        probabilityPct: row.probabilityPct,
        msamGatePassed: row.msamGatePassed,
        family: row.trace.family,
        selectionKey: row.trace.selectionKey,
      },
      modelStats: est
        ? {
            lambdas: est.lambdas,
            homeWinPct: pctFromProb(m?.home),
            drawPct: pctFromProb(m?.draw),
            awayWinPct: pctFromProb(m?.away),
            over25Pct: pctFromProb(m?.over25),
            under25Pct: pctFromProb(m?.under25),
            bttsYesPct: pctFromProb(m?.bttsYes),
            hsh2hGt1hPct: pctFromProb(m?.p2h_gt_1h),
            diehYesPct: pctFromProb(m?.dieh?.diehYes),
            cornersOver95Pct: pctFromProb(m?.cornersOver95),
          }
        : null,
    };
  });

  return { summary, matches };
}

export function validateOpenAiPicksResponse(
  raw: unknown,
  expectedFixtureIds: number[]
): OpenAiPickDraft[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("OpenAI response is not an object");
  }
  const picks = (raw as { picks?: unknown }).picks;
  if (!Array.isArray(picks)) {
    throw new Error("OpenAI response missing picks array");
  }

  const expected = new Set(expectedFixtureIds);
  const seen = new Set<number>();
  const out: OpenAiPickDraft[] = [];

  for (const item of picks) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const apiFixtureId = Number(p.apiFixtureId);
    if (!Number.isFinite(apiFixtureId) || !expected.has(apiFixtureId)) continue;
    if (seen.has(apiFixtureId)) continue;

    const marketFamily = String(p.marketFamily ?? "").trim();
    if (!ALLOWED_FAMILIES.includes(marketFamily as MarketFamilyId)) continue;

    const selectionKey = String(p.selectionKey ?? "").trim();
    const prediction = String(p.prediction ?? "").trim();
    const marketLabel =
      String(p.marketLabel ?? "").trim() ||
      FAMILY_LABELS[marketFamily as MarketFamilyId] ||
      marketFamily;
    const rationale = String(p.rationale ?? "").trim();
    const confidencePct = Math.max(
      0,
      Math.min(100, Math.round(Number(p.confidencePct) || 0))
    );
    if (!selectionKey || !prediction || !rationale) continue;

    const lineRaw = p.line;
    const line =
      lineRaw == null || lineRaw === ""
        ? null
        : Number.isFinite(Number(lineRaw))
          ? Number(lineRaw)
          : null;
    const comboId =
      p.comboId == null || p.comboId === ""
        ? null
        : String(p.comboId).trim();

    seen.add(apiFixtureId);
    out.push({
      apiFixtureId,
      marketFamily,
      marketLabel,
      selectionKey,
      line,
      comboId,
      prediction,
      confidencePct,
      rationale,
    });
  }

  const missing = expectedFixtureIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(
      `OpenAI response missing picks for fixture ids: ${missing.join(", ")}`
    );
  }

  return out;
}

async function loadOpenAiHistoricalByFamily(): Promise<
  OpenAiContextSummary["openAiHistoricalByFamily"]
> {
  try {
    const db = await getDb();
    const rows = await db
      .select({
        marketFamily: openaiWeekendPredictions.marketFamily,
        wins: sql<number>`count(*) filter (where ${openaiWeekendPredictions.result} = 'win')::int`,
        losses: sql<number>`count(*) filter (where ${openaiWeekendPredictions.result} = 'loss')::int`,
      })
      .from(openaiWeekendPredictions)
      .where(isNotNull(openaiWeekendPredictions.result))
      .groupBy(openaiWeekendPredictions.marketFamily);

    return rows.map((r) => {
      const wins = Number(r.wins);
      const losses = Number(r.losses);
      const total = wins + losses;
      return {
        marketFamily: r.marketFamily,
        wins,
        losses,
        winRate: total > 0 ? Math.round((wins / total) * 1000) / 10 : null,
      };
    });
  } catch {
    return [];
  }
}

function scoreResultToOpenAiResult(
  score: ScoreResult | null | undefined
): string | null {
  if (score === "correct") return "win";
  if (score === "wrong") return "loss";
  if (score === "push") return "push";
  if (score === "void") return "void";
  return null;
}

function familyToMarketKey(
  family: string,
  selectionKey: string
): LogMarketKey | "combo" {
  switch (family) {
    case "RESULT_1X2":
      return "1x2";
    case "DOUBLE_CHANCE":
      return "double_chance";
    case "TOTALS":
      return "total_goals_ou";
    case "TEAM_GOALS":
      return selectionKey.startsWith("away") ? "away_goals_ou" : "home_goals_ou";
    case "BTTS":
      return "btts";
    case "HSH":
      return "more_goals_half";
    case "HT_RESULT":
      return "ht_1x2";
    case "DIEH":
      return "draw_one_half";
    case "WIN_ONE_HALF":
      return "win_one_half";
    case "CORNERS":
      return selectionKey.startsWith("home") ? "home_corners_ou" : "corners_ou";
    case "SOT":
      return "sot_ou";
    case "COMBO":
      return "combo";
    default:
      return "1x2";
  }
}

function logMatchFromLiveFixture(
  pick: Pick<
    OpenAiWeekendPick,
    "apiFixtureId" | "homeTeam" | "awayTeam" | "league" | "kickoffIso"
  >,
  live: NonNullable<Awaited<ReturnType<typeof getFixtureById>>>
): LogMatch {
  return {
    id: String(pick.apiFixtureId),
    homeTeam: pick.homeTeam,
    awayTeam: pick.awayTeam,
    league: pick.league,
    matchDate: pick.kickoffIso.slice(0, 10),
    apiFixtureId: pick.apiFixtureId,
    fixtureStatus: live.status,
    predictions: {},
    actualResults: {},
    scored: {},
    teamStats: {
      home: {
        goals: live.homeGoals ?? undefined,
        corners: live.homeCorners ?? undefined,
      },
      away: {
        goals: live.awayGoals ?? undefined,
        corners: live.awayCorners ?? undefined,
      },
    },
  };
}

export function gradeOpenAiPick(
  pick: Pick<
    OpenAiWeekendPick,
    | "marketFamily"
    | "selectionKey"
    | "line"
    | "comboId"
    | "prediction"
    | "apiFixtureId"
    | "homeTeam"
    | "awayTeam"
    | "league"
    | "kickoffIso"
  >,
  match: LogMatch
): string | null {
  const actuals = deriveActualsFromFacts(match);
  const marketKey = familyToMarketKey(pick.marketFamily, pick.selectionKey);

  if (marketKey === "combo" && pick.comboId) {
    const score = scoreComboLeg(pick.comboId, actuals, match.teamStats);
    return scoreResultToOpenAiResult(score);
  }

  if (marketKey === "combo") return null;

  const actual = actuals[marketKey]?.actual;
  if (actual == null) return null;

  const score = scoreMarket(
    marketKey,
    pick.prediction,
    pick.line ?? undefined,
    actual
  );
  return scoreResultToOpenAiResult(score);
}

export async function gradeOpenAiWeekendPredictions(
  weekendBatchId?: string
): Promise<{ graded: number; skipped: number }> {
  const db = await getDb();
  const picks = weekendBatchId
    ? await db
        .select()
        .from(openaiWeekendPredictions)
        .where(
          and(
            isNull(openaiWeekendPredictions.result),
            eq(openaiWeekendPredictions.weekendBatchId, weekendBatchId)
          )
        )
    : await db
        .select()
        .from(openaiWeekendPredictions)
        .where(isNull(openaiWeekendPredictions.result));

  let graded = 0;
  let skipped = 0;
  const now = new Date();

  for (const pick of picks) {
    const live = await getFixtureById(pick.apiFixtureId);
    const status = (live?.status ?? "").toUpperCase();
    if (!live || !["FT", "AET", "PEN"].includes(status)) {
      skipped += 1;
      continue;
    }
    if (live.homeGoals == null || live.awayGoals == null) {
      skipped += 1;
      continue;
    }

    const match = logMatchFromLiveFixture(pick, live);
    const result = gradeOpenAiPick(pick, match);
    if (!result) {
      skipped += 1;
      continue;
    }

    await db
      .update(openaiWeekendPredictions)
      .set({ result, gradedAt: now })
      .where(eq(openaiWeekendPredictions.id, pick.id));
    graded += 1;
  }

  return { graded, skipped };
}

function rowByFixtureId(
  rows: WeekendOpportunityRow[]
): Map<number, WeekendOpportunityRow> {
  return new Map(rows.map((r) => [r.apiFixtureId, r]));
}

export async function loadLatestOpenAiRun(
  weekendBatchId?: string | null
): Promise<OpenAiWeekendRunResult | null> {
  const db = await getDb();
  const runs = weekendBatchId
    ? await db
        .select()
        .from(openaiWeekendPredictionRuns)
        .where(eq(openaiWeekendPredictionRuns.weekendBatchId, weekendBatchId))
        .orderBy(desc(openaiWeekendPredictionRuns.generatedAt))
        .limit(1)
    : await db
        .select()
        .from(openaiWeekendPredictionRuns)
        .orderBy(desc(openaiWeekendPredictionRuns.generatedAt))
        .limit(1);

  const run = runs[0];
  if (!run) return null;

  const pickRows = await db
    .select()
    .from(openaiWeekendPredictions)
    .where(eq(openaiWeekendPredictions.runId, run.id))
    .orderBy(openaiWeekendPredictions.apiFixtureId);

  let summary: OpenAiContextSummary = {
    learnerWinRate: null,
    learnerScoredPicks: 0,
    topReliableRanges: [],
    weakRanges: [],
    cautiousClubs: [],
    topTeamMarkets: [],
    openAiHistoricalByFamily: [],
  };
  if (run.summaryJson) {
    try {
      summary = JSON.parse(run.summaryJson) as OpenAiContextSummary;
    } catch {
      /* ignore */
    }
  }

  return {
    runId: run.id,
    weekendBatchId: run.weekendBatchId,
    model: run.model,
    promptVersion: run.promptVersion,
    generatedAt: run.generatedAt.toISOString(),
    matchCount: run.matchCount,
    summary,
    picks: pickRows.map((p) => ({
      id: p.id,
      runId: p.runId,
      weekendBatchId: p.weekendBatchId,
      apiFixtureId: p.apiFixtureId,
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
      league: p.league,
      kickoffIso: p.kickoffIso,
      marketFamily: p.marketFamily,
      marketLabel: p.marketLabel,
      selectionKey: p.selectionKey,
      line: p.line,
      comboId: p.comboId,
      prediction: p.prediction,
      confidencePct: p.confidencePct,
      rationale: p.rationale,
      systemMarket: p.systemMarket,
      systemPrediction: p.systemPrediction,
      systemProbabilityPct: p.systemProbabilityPct,
      result: p.result,
      gradedAt: p.gradedAt?.toISOString() ?? null,
    })),
  };
}

const SYSTEM_PROMPT = `You are a football betting analyst. Given system model stats and personal learner history, pick exactly ONE market per fixture.

Rules:
- Use only these marketFamily values: ${ALLOWED_FAMILIES.join(", ")}
- Never use HANDICAP
- Return exactly one pick per apiFixtureId provided
- selectionKey must be a valid key for that family (e.g. home/draw/away, over_2_5, yes/no, first_half/second_half)
- For COMBO family include comboId (e.g. btts_yes_over_2_5, 1x_over_2_5)
- For numeric markets include line when applicable
- Prefer markets supported by learner reliability and team history when sample exists
- confidencePct is 0-100 reflecting both model probability and learner support
- rationale: 1-2 concise sentences citing stats

Respond with JSON only: { "picks": [ ... ] }`;

async function callOpenAiForPicks(
  contextJson: string,
  retryNote?: string
): Promise<unknown> {
  const client = getOpenAiClient();
  const model = openAiModel();
  const userContent = retryNote
    ? `${contextJson}\n\nRETRY NOTE: ${retryNote}`
    : contextJson;

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.3,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Analyze these weekend fixtures and return one pick per fixture.\n\n${userContent}`,
      },
    ],
  });

  const text = completion.choices[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned empty response");
  return JSON.parse(text) as unknown;
}

export async function generateOpenAiWeekendPredictions(opts?: {
  refresh?: boolean;
}): Promise<OpenAiWeekendRunResult> {
  const pool = await buildWeekendPool({ refresh: opts?.refresh });
  const topRows = sliceTopWeekendRows(pool.topRows);

  if (!pool.weekendBatchId || topRows.length === 0) {
    throw new Error(
      pool.warnings[0] ?? "No weekend fixtures available for OpenAI predictions"
    );
  }

  const historicalByFamily = await loadOpenAiHistoricalByFamily();
  const estimateMap = estimatesByFixtureId(pool.weekendFixtures, pool.estimates);
  const { summary, matches } = buildOpenAiContext({
    rows: topRows,
    estimates: estimateMap,
    learnerStats: pool.learnerStats,
    reliabilityEntries: pool.reliabilityEntries,
    historicalByFamily,
  });

  const fixtureIds = topRows.map((r) => r.apiFixtureId);
  const contextPayload = JSON.stringify({ summary, matches });
  const rowMap = rowByFixtureId(topRows);

  let parsed: unknown;
  try {
    parsed = await callOpenAiForPicks(contextPayload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`OpenAI request failed: ${msg}`);
  }

  let drafts: OpenAiPickDraft[];
  try {
    drafts = validateOpenAiPicksResponse(parsed, fixtureIds);
  } catch (firstErr) {
    const note =
      firstErr instanceof Error ? firstErr.message : "validation failed";
    parsed = await callOpenAiForPicks(contextPayload, note);
    drafts = validateOpenAiPicksResponse(parsed, fixtureIds);
  }

  const db = await getDb();
  const now = new Date();
  const model = openAiModel();

  const [run] = await db
    .insert(openaiWeekendPredictionRuns)
    .values({
      weekendBatchId: pool.weekendBatchId,
      model,
      promptVersion: OPENAI_PROMPT_VERSION,
      generatedAt: now,
      matchCount: drafts.length,
      summaryJson: JSON.stringify(summary),
    })
    .returning();

  if (!run) throw new Error("Failed to persist OpenAI run");

  const pickValues = drafts.map((d) => {
    const sys = rowMap.get(d.apiFixtureId);
    return {
      runId: run.id,
      weekendBatchId: pool.weekendBatchId!,
      apiFixtureId: d.apiFixtureId,
      homeTeam: sys?.homeTeam ?? "",
      awayTeam: sys?.awayTeam ?? "",
      league: sys?.league ?? "",
      kickoffIso: sys?.kickoffIso ?? "",
      marketFamily: d.marketFamily,
      marketLabel: d.marketLabel,
      selectionKey: d.selectionKey,
      line: d.line ?? null,
      comboId: d.comboId ?? null,
      prediction: d.prediction,
      confidencePct: d.confidencePct,
      rationale: d.rationale,
      systemMarket: sys?.marketLabel ?? null,
      systemPrediction: sys?.prediction ?? null,
      systemProbabilityPct:
        sys?.probabilityPct != null ? Math.round(sys.probabilityPct) : null,
    };
  });

  const inserted = await db
    .insert(openaiWeekendPredictions)
    .values(pickValues)
    .returning();

  return {
    runId: run.id,
    weekendBatchId: pool.weekendBatchId,
    model,
    promptVersion: OPENAI_PROMPT_VERSION,
    generatedAt: now.toISOString(),
    matchCount: inserted.length,
    summary,
    picks: inserted.map((p) => ({
      id: p.id,
      runId: p.runId,
      weekendBatchId: p.weekendBatchId,
      apiFixtureId: p.apiFixtureId,
      homeTeam: p.homeTeam,
      awayTeam: p.awayTeam,
      league: p.league,
      kickoffIso: p.kickoffIso,
      marketFamily: p.marketFamily,
      marketLabel: p.marketLabel,
      selectionKey: p.selectionKey,
      line: p.line,
      comboId: p.comboId,
      prediction: p.prediction,
      confidencePct: p.confidencePct,
      rationale: p.rationale,
      systemMarket: p.systemMarket,
      systemPrediction: p.systemPrediction,
      systemProbabilityPct: p.systemProbabilityPct,
      result: p.result,
      gradedAt: p.gradedAt?.toISOString() ?? null,
    })),
  };
}

export async function getCurrentWeekendBatchId(): Promise<string | null> {
  const pool = await buildWeekendPool();
  return pool.weekendBatchId;
}
