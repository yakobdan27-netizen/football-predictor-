import type {
  AnalysisHistory,
  LogMarketKey,
  MarketPrediction,
  PredictionBatch,
  RecommendedPick,
  ClubProfilesStore,
  LearnerStatsStore,
  TeamCharacteristicsStore,
} from "./types";
import { SCHEMA_VERSION } from "./types";
import { LOG_MARKET_MAP } from "./markets-config";
import { oddsToBand, resultExportLabel, isValidOdds } from "./odds-bands";
import { flattenScoredRows } from "./analysis";

const CSV_COLUMNS = [
  "version",
  "batchName",
  "league",
  "date",
  "home",
  "away",
  "market",
  "prediction",
  "line",
  "confidence",
  "odds",
  "oddsBand",
  "action",
  "judgment",
  "accepted",
  "combinedOdds",
  "riskLevel",
  "includedInRecommended",
  "similarityScore",
  "matchJudgment",
  "evidenceSummary",
  "selected",
  "actual",
  "result",
] as const;

const ODDS_ANALYSIS_COLUMNS = [
  "date",
  "batchName",
  "league",
  "home",
  "away",
  "market",
  "prediction",
  "odds",
  "oddsBand",
  "confidence",
  "result",
] as const;

function escapeCsv(value: string | number | undefined | null): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildExportJson(
  batches: PredictionBatch[],
  analysis: AnalysisHistory | null,
  clubProfiles: ClubProfilesStore | null = null,
  learnerStats: LearnerStatsStore | null = null,
  teamCharacteristics: TeamCharacteristicsStore | null = null
): string {
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      batches,
      analysisHistory: analysis,
      clubProfiles,
      learnerStats,
      teamCharacteristics,
    },
    null,
    2
  );
}

function pushCsvRow(
  lines: string[],
  version: string,
  batch: PredictionBatch,
  match: { homeTeam: string; awayTeam: string },
  key: LogMarketKey,
  pred: MarketPrediction,
  extra: {
    action?: string;
    judgment?: string;
    accepted?: boolean | string;
    combinedOdds?: string | number;
    riskLevel?: string;
    includedInRecommended?: string;
    similarityScore?: string | number;
    matchJudgment?: string;
    evidenceSummary?: string;
    selected?: string;
  },
  scored: string
) {
  const actual =
    batch.matches.find(
      (m) => m.homeTeam === match.homeTeam && m.awayTeam === match.awayTeam
    )?.actualResults[key]?.actual ?? "";
  const label = LOG_MARKET_MAP[key]?.label ?? key;
  const odds = isValidOdds(pred.odds) ? pred.odds : "";
  const band = isValidOdds(pred.odds) ? oddsToBand(pred.odds!) : "";
  lines.push(
    [
      version,
      batch.batchName,
      batch.league,
      batch.date,
      match.homeTeam,
      match.awayTeam,
      label,
      pred.prediction,
      pred.line ?? "",
      pred.confidence,
      odds,
      band,
      extra.action ?? "",
      extra.judgment ?? "",
      extra.accepted === true ? "yes" : extra.accepted === false ? "no" : "",
      extra.combinedOdds ?? "",
      extra.riskLevel ?? "",
      extra.includedInRecommended ?? "",
      extra.similarityScore ?? "",
      extra.matchJudgment ?? "",
      extra.evidenceSummary ?? "",
      extra.selected ?? "",
      actual,
      scored,
    ]
      .map(escapeCsv)
      .join(",")
  );
}

export function buildExportCsv(batches: PredictionBatch[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const batch of batches) {
    for (const match of batch.matches) {
      for (const [key, pred] of Object.entries(match.predictions) as [
        LogMarketKey,
        MarketPrediction,
      ][]) {
        pushCsvRow(
          lines,
          "original",
          batch,
          match,
          key,
          pred,
          {},
          resultExportLabel(match.scored[key])
        );
      }
    }
    if (batch.recommended) {
      const summary = batch.recommended.summary;
      const gameListByMatch = new Map(
        (batch.recommended.gameList ?? []).map((g) => [g.matchId, g])
      );
      const includedIds = new Set(batch.recommended.matches.map((m) => m.id));
      for (const rm of batch.recommended.matches) {
        const gameEntry = gameListByMatch.get(rm.id);
        for (const [key, rp] of Object.entries(rm.predictions) as [
          LogMarketKey,
          RecommendedPick,
        ][]) {
          const origMatch = batch.matches.find((m) => m.id === rm.id);
          if (!origMatch) continue;
          pushCsvRow(
            lines,
            "recommended",
            batch,
            rm,
            key,
            rp,
            {
              action: rp.action,
              judgment: rp.judgment,
              accepted: rp.accepted,
              combinedOdds: summary.totalCombinedOdds ?? "",
              riskLevel: summary.riskLevel,
              includedInRecommended: "yes",
              similarityScore: gameEntry?.similarityScore ?? "",
              matchJudgment: gameEntry?.judgmentText ?? "",
              evidenceSummary: gameEntry?.evidence.map((e) => `${e.label}: ${e.value}`).join("; ") ?? "",
              selected: "yes",
            },
            rp.action === "remove"
              ? ""
              : resultExportLabel(origMatch.recommendedScored?.[key])
          );
        }
      }
      for (const match of batch.matches) {
        if (includedIds.has(match.id)) continue;
        const gameEntry = gameListByMatch.get(match.id);
        for (const [key, pred] of Object.entries(match.predictions) as [
          LogMarketKey,
          MarketPrediction,
        ][]) {
          pushCsvRow(
            lines,
            "recommended",
            batch,
            match,
            key,
            pred,
            {
              action: "excluded",
              judgment: summary.exclusions.find((e) => e.matchId === match.id)?.reason ?? "Not selected",
              combinedOdds: summary.totalCombinedOdds ?? "",
              riskLevel: summary.riskLevel,
              includedInRecommended: "no",
              similarityScore: gameEntry?.similarityScore ?? "",
              matchJudgment: gameEntry?.judgmentText ?? "",
              evidenceSummary: gameEntry?.evidence.map((e) => `${e.label}: ${e.value}`).join("; ") ?? "",
              selected: "no",
            },
            ""
          );
        }
      }
    }
  }
  return lines.join("\n");
}

export function buildComparisonCsv(batches: PredictionBatch[]): string {
  const cols = [
    "batchName",
    "home",
    "away",
    "market",
    "originalPrediction",
    "recommendedPrediction",
    "action",
    "judgment",
    "accepted",
    "combinedOdds",
    "riskLevel",
    "includedInRecommended",
    "similarityScore",
    "matchJudgment",
    "evidenceSummary",
    "selected",
  ];
  const lines = [cols.join(",")];
  for (const batch of batches) {
    if (!batch.recommended) continue;
    const summary = batch.recommended.summary;
    const includedIds = new Set(batch.recommended.matches.map((m) => m.id));
    const gameListByMatch = new Map(
      (batch.recommended.gameList ?? []).map((g) => [g.matchId, g])
    );
    for (const match of batch.matches) {
      const rm = batch.recommended.matches.find((m) => m.id === match.id);
      const included = includedIds.has(match.id);
      const gameEntry = gameListByMatch.get(match.id);
      for (const [key, op] of Object.entries(match.predictions) as [
        LogMarketKey,
        MarketPrediction,
      ][]) {
        const rp = rm?.predictions[key];
        const label = LOG_MARKET_MAP[key]?.label ?? key;
        const origStr = `${op.prediction}${op.line != null ? ` ${op.line}` : ""} @ ${op.odds ?? "?"}`;
        const recStr = rp
          ? rp.action === "remove"
            ? "(removed)"
            : `${rp.prediction}${rp.line != null ? ` ${rp.line}` : ""} @ ${rp.odds ?? "?"}`
          : included
            ? ""
            : "(excluded)";
        lines.push(
          [
            batch.batchName,
            match.homeTeam,
            match.awayTeam,
            label,
            origStr,
            recStr,
            rp?.action ?? (included ? "" : "excluded"),
            rp?.judgment ??
              summary.exclusions.find((e) => e.matchId === match.id)?.reason ??
              "",
            rp?.accepted ? "yes" : "no",
            summary.totalCombinedOdds ?? "",
            summary.riskLevel,
            included ? "yes" : "no",
            gameEntry?.similarityScore ?? "",
            gameEntry?.judgmentText ?? "",
            gameEntry?.evidence.map((e) => `${e.label}: ${e.value}`).join("; ") ?? "",
            gameEntry?.selected ? "yes" : "no",
          ]
            .map(escapeCsv)
            .join(",")
        );
      }
    }
  }
  return lines.join("\n");
}

export function buildOddsAnalysisCsv(batches: PredictionBatch[]): string {
  const rows = flattenScoredRows(batches).filter(
    (r) => r.odds != null && isValidOdds(r.odds)
  );
  const lines = [ODDS_ANALYSIS_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.batchName,
        r.league,
        r.homeTeam,
        r.awayTeam,
        LOG_MARKET_MAP[r.market]?.label ?? r.market,
        r.prediction,
        r.odds,
        oddsToBand(r.odds!),
        r.confidence,
        resultExportLabel(r.result),
      ]
        .map(escapeCsv)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportJson(
  batches: PredictionBatch[],
  analysis: AnalysisHistory | null,
  clubProfiles: ClubProfilesStore | null = null,
  learnerStats: LearnerStatsStore | null = null,
  teamCharacteristics: TeamCharacteristicsStore | null = null
): void {
  downloadFile(
    buildExportJson(batches, analysis, clubProfiles, learnerStats, teamCharacteristics),
    `prediction-log-${new Date().toISOString().slice(0, 10)}.json`,
    "application/json"
  );
}

export function exportCsv(batches: PredictionBatch[]): void {
  downloadFile(
    buildExportCsv(batches),
    `prediction-log-${new Date().toISOString().slice(0, 10)}.csv`,
    "text/csv;charset=utf-8"
  );
}

export function exportComparisonCsv(batches: PredictionBatch[]): void {
  downloadFile(
    buildComparisonCsv(batches),
    `prediction-comparison-${new Date().toISOString().slice(0, 10)}.csv`,
    "text/csv;charset=utf-8"
  );
}

export function exportOddsAnalysisCsv(batches: PredictionBatch[]): void {
  downloadFile(
    buildOddsAnalysisCsv(batches),
    `odds-analysis-${new Date().toISOString().slice(0, 10)}.csv`,
    "text/csv;charset=utf-8"
  );
}
