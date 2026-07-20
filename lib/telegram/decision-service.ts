import { defaultCombinedOddsSettings } from "@/lib/prediction-log/combo-settings";
import { processBatchDecisions } from "@/lib/prediction-log/decision-maker";
import { loadAllBatches } from "@/lib/prediction-log/club-store";
import { loadTeamsQualityStore } from "@/lib/prediction-log/teams-quality-store";
import { recomputeAnalysis } from "@/lib/prediction-log/analysis";
import type { PredictionBatch } from "@/lib/prediction-log/types";
import { getOwnedBatch } from "./ownership";

export interface BotDecisionMarket {
  rank: 1 | 2 | 3;
  label: string;
  prediction: string;
  confidence: number;
  category: string;
  warn: boolean;
}

export interface BotMatchDecision {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  date: string;
  markets: BotDecisionMarket[];
  incomplete: boolean;
}

export interface BotDecisionResponse {
  batchId: string;
  batchName: string;
  decisions: BotMatchDecision[];
}

function confidenceWarn(confidence: number): boolean {
  return confidence < 60;
}

/**
 * Run the same Decision Maker engine as the web app for an owned batch.
 */
export async function runDecisionForOwnedBatch(
  batchId: string,
  ownerUserId: string
): Promise<BotDecisionResponse> {
  const batch = await getOwnedBatch(batchId, ownerUserId);
  const allBatches = await loadAllBatches();
  const comboSettings = defaultCombinedOddsSettings();

  let analysis = null;
  try {
    analysis = recomputeAnalysis(allBatches);
  } catch {
    analysis = null;
  }

  const teamsQuality = await loadTeamsQualityStore().catch(() => null);

  const rows = processBatchDecisions({
    batch,
    allBatches: allBatches.length ? allBatches : [batch],
    comboSettings,
    analysis,
    teamsQuality,
    learnerStats: null,
  });

  return {
    batchId: batch.id,
    batchName: batch.batchName,
    decisions: rows.map((row) => ({
      matchId: row.match.id,
      homeTeam: row.match.homeTeam,
      awayTeam: row.match.awayTeam,
      league: row.league,
      date: row.match.matchDate ?? batch.date,
      incomplete: row.incomplete,
      markets: row.markets.slice(0, 3).map((m, i) => ({
        rank: (i + 1) as 1 | 2 | 3,
        label: m.label,
        prediction: m.prediction,
        confidence: Math.round(m.confidence),
        category: m.category,
        warn: confidenceWarn(m.confidence),
      })),
    })),
  };
}

export function formatDecisionMessages(result: BotDecisionResponse): string[] {
  const chunks: string[] = [];
  let buf = `🎯 Decision — ${result.batchName}\n\n`;

  for (const d of result.decisions) {
    const dateLabel = formatShortDate(d.date);
    let block = `⚽ ${d.homeTeam} vs ${d.awayTeam} — ${d.league} — ${dateLabel}\n`;
    block += `Top 3 markets:\n`;
    for (const m of d.markets) {
      const band =
        m.confidence >= 80 ? "High" : m.confidence >= 60 ? "Medium" : "Low";
      const warn = m.warn ? " ⚠️" : "";
      block += `${m.rank}) ${m.label}: ${m.prediction} — Confidence: ${band} (${m.confidence}%)${warn}\n`;
    }
    if (d.incomplete) {
      block += `(Limited sources — advisory only)\n`;
    }
    block += `──────────────\n`;

    if (buf.length + block.length > 3500) {
      chunks.push(buf.trimEnd());
      buf = block;
    } else {
      buf += block + "\n";
    }
  }

  if (buf.trim()) chunks.push(buf.trimEnd());
  return chunks.length ? chunks : [`🎯 Decision — ${result.batchName}\n(No matches)`];
}

function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso.slice(0, 10);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[parseInt(m[2]!, 10) - 1] ?? m[2];
  return `${parseInt(m[3]!, 10)} ${month}`;
}

/** Create a telegram-sourced PredictionBatch shell (fixtures only). */
export function buildTelegramBatch(params: {
  ownerUserId: string;
  batchName: string;
  date: string;
  league: string;
  matches: {
    homeTeam: string;
    awayTeam: string;
    league: string;
    date: string;
  }[];
}): PredictionBatch {
  const id = `TG-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
  return {
    id,
    batchName: params.batchName.trim(),
    date: params.date,
    league: params.league,
    createdAt: new Date().toISOString(),
    batchKind: "manual",
    ownerUserId: params.ownerUserId,
    source: "telegram",
    matches: params.matches.map((m, i) => ({
      id: `${id}-m${i + 1}`,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      league: m.league,
      matchDate: m.date,
      predictions: {},
      actualResults: {},
      scored: {},
    })),
  };
}
