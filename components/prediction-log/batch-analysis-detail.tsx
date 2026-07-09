"use client";

import { useState } from "react";
import { ScoreGridHeatmap } from "./score-grid-heatmap";
import { CorrectScorePanel } from "./correct-score-panel";
import { LOG_MARKET_MAP, pickOptionsForMarket } from "@/lib/prediction-log/markets-config";
import { MATCH_JUDGMENT_LABELS } from "@/lib/prediction-log/recommendation-config";
import {
  confidenceBand,
  confidenceBandLabel,
  CONFIDENCE_BAND_COLORS,
} from "@/lib/prediction-log/master-probability-config";
import { isSameDateDedupReason } from "@/lib/prediction-log/same-date-market-dedup";
import {
  getBatchDisplayId,
  getMarketComparisonForMatch,
  getMathSnapshot,
  getSelectedPickForMatch,
  getTierAccentColor,
} from "@/lib/prediction-log/snapshot-readers";
import { ComboAnalysisSection } from "./combo-analysis-section";
import { loadCombinedOddsSettings } from "@/lib/prediction-log/combo-settings";
import type {
  EvidencePoint,
  FrozenMarketEntry,
  LogMarketKey,
  LogMatch,
  MatchGameListEntry,
  MatchJudgmentLabel,
  PredictionBatch,
  RecommendedPick,
} from "@/lib/prediction-log/types";

interface BatchAnalysisDetailProps {
  batch: PredictionBatch;
  sourceBatch?: PredictionBatch | null;
  learnerEnabled?: boolean;
  highlightCombos?: boolean;
  allBatches?: PredictionBatch[];
  comboSettings?: import("@/lib/prediction-log/types").CombinedOddsSettings;
  analysis?: import("@/lib/prediction-log/types").AnalysisHistory | null;
  teamsQuality?: import("@/lib/prediction-log/teams-quality-types").TeamsQualityStore | null;
  learnerStats?: import("@/lib/prediction-log/types").LearnerStatsStore | null;
}

const JUDGMENT_COLORS: Record<MatchJudgmentLabel, string> = {
  strong_keep: "var(--accent)",
  keep_caution: "var(--warn)",
  skip: "var(--danger)",
};

function pickLabel(
  key: LogMarketKey,
  pred: { prediction: string; line?: number },
  home: string,
  away: string
): string {
  const opts = pickOptionsForMarket(key, home, away, pred.line);
  const found = opts.find((o) => o.value === pred.prediction);
  if (found) return found.label;
  if (pred.line != null) return `${pred.prediction} ${pred.line}`;
  return pred.prediction;
}

function GameListEntry({ entry }: { entry: MatchGameListEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        padding: "0.75rem",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        marginBottom: "0.5rem",
        opacity: entry.selected ? 1 : 0.72,
        background: entry.selected ? "rgba(76, 175, 80, 0.04)" : undefined,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", justifyContent: "space-between" }}>
        <strong>
          {entry.homeTeam} vs {entry.awayTeam}
        </strong>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Similarity {entry.similarityScore}</span>
          {entry.legOdds != null && (
            <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Leg {entry.legOdds}</span>
          )}
          <span style={{ fontSize: "0.7rem", fontWeight: 700, color: JUDGMENT_COLORS[entry.judgment], textTransform: "uppercase" }}>
            {entry.judgmentText}
          </span>
          {entry.selected && (
            <span style={{ fontSize: "0.7rem", color: "var(--accent)", fontWeight: 600 }}>Selected</span>
          )}
        </div>
      </div>
      {entry.skipReason && !entry.selected && (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.35rem" }}>{entry.skipReason}</p>
      )}
      {entry.evidence.length > 0 && (
        <div style={{ marginTop: "0.35rem" }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: "0.75rem", padding: "0.15rem 0.5rem" }}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide evidence" : `Evidence (${entry.evidence.length})`}
          </button>
          {open && (
            <ul style={{ marginTop: "0.35rem", paddingLeft: "1.25rem", fontSize: "0.8rem" }}>
              {entry.evidence.map((e, i) => (
                <li key={i}>
                  <strong>{e.label}:</strong> {e.value}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MarketComparisonTable({ entries }: { entries: FrozenMarketEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse", marginTop: "0.5rem" }}>
      <thead>
        <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
          <th style={{ padding: "0.35rem 0.5rem" }}>Market</th>
          <th style={{ padding: "0.35rem 0.5rem" }}>Pick</th>
          <th style={{ padding: "0.35rem 0.5rem" }}>P_final</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, i) => (
          <tr
            key={`${entry.marketKey}-${i}`}
            style={{
              borderBottom: "1px solid var(--border)",
              background: entry.selected ? "rgba(76, 175, 80, 0.06)" : undefined,
            }}
          >
            <td style={{ padding: "0.35rem 0.5rem" }}>{entry.marketLabel}</td>
            <td style={{ padding: "0.35rem 0.5rem" }}>{entry.predictionLabel}</td>
            <td style={{ padding: "0.35rem 0.5rem", fontWeight: entry.selected ? 700 : 400 }}>
              {entry.pFinal}%
              {entry.selected ? " ✓" : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FrozenModelOutputs({ pick }: { pick: RecommendedPick }) {
  const stat = pick.mathSnapshot?.statLayer;
  if (!stat) return null;
  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.5rem" }}>Model outputs (frozen)</div>
      <div className="stat-grid" style={{ marginBottom: "0.75rem" }}>
        <div>
          <div className="stat-label">P_dc</div>
          <div className="stat-value">{stat.pDc}%</div>
        </div>
        <div>
          <div className="stat-label">P_ml</div>
          <div className="stat-value">{stat.pMl}%</div>
        </div>
        <div>
          <div className="stat-label">P_stat</div>
          <div className="stat-value">{stat.pStat}%</div>
        </div>
        <div>
          <div className="stat-label">P_custom</div>
          <div className="stat-value">{stat.pCustom}%</div>
        </div>
      </div>
      {stat.mlProbs && (
        <div style={{ fontSize: "0.8125rem", marginBottom: "0.5rem" }}>
          ML: Home {(stat.mlProbs.home * 100).toFixed(1)}% · Draw {(stat.mlProbs.draw * 100).toFixed(1)}% · Away{" "}
          {(stat.mlProbs.away * 100).toFixed(1)}%
        </div>
      )}
      {stat.bayesianLayer && (
        <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          Bayesian: {stat.bayesianLayer.pMarket}% [{stat.bayesianLayer.pLo}% – {stat.bayesianLayer.pHi}%] · width{" "}
          {stat.bayesianLayer.intervalWidth}% · confidence {stat.bayesianLayer.confidence}%
        </div>
      )}
      {stat.scoreGrid && stat.scoreGrid.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.8125rem", marginBottom: "0.35rem" }}>Dixon-Coles score grid (%)</div>
          <ScoreGridHeatmap grid={stat.scoreGrid} />
        </div>
      )}
    </div>
  );
}

function MatchAnalysisBlock({
  batch,
  rm,
  gameEntry,
  accentColor,
}: {
  batch: PredictionBatch;
  rm: (NonNullable<PredictionBatch["recommended"]>["matches"])[number];
  gameEntry?: MatchGameListEntry;
  accentColor: string;
}) {
  const recommended = batch.recommended!;
  const math = recommended.mathSnapshot;
  const selected = getSelectedPickForMatch(rm);
  if (!selected) return null;
  const { marketKey, pick } = selected;

  const pFinal = math?.pFinalByMatch[rm.id] ?? pick.pFinal;
  const pFinalBase =
    math?.pFinalBaseByMatch?.[rm.id] ?? math?.tierInfoByMatch?.[rm.id]?.pFinalBase;
  const tierInfo = math?.tierInfoByMatch?.[rm.id];
  const band = pFinal != null ? confidenceBand(pFinal) : null;
  const bandColor = band ? CONFIDENCE_BAND_COLORS[band] : undefined;
  const marketComparison = getMarketComparisonForMatch(batch, rm.id);
  const systemPick = math?.systemPickByMatch?.[rm.id];

  return (
    <div className="card" style={{ marginBottom: "1rem", background: "rgba(255,255,255,0.01)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
        <strong>
          {rm.homeTeam}
          {tierInfo?.homeTier ? ` (${tierInfo.homeTier})` : ""} vs {rm.awayTeam}
          {tierInfo?.awayTier ? ` (${tierInfo.awayTier})` : ""}
        </strong>
        {pFinal != null && band && (
          <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: bandColor, whiteSpace: "nowrap" }}>
            {pFinal}% — {confidenceBandLabel(band)}
          </span>
        )}
      </div>

      {systemPick && (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem" }}>
          <span style={{ color: "var(--muted)" }}>System pick: </span>
          {systemPick.label}
        </p>
      )}

      <div style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
        <div>
          <span style={{ color: "var(--muted)" }}>Selected market: </span>
          {LOG_MARKET_MAP[marketKey]?.label ?? marketKey} — {pickLabel(marketKey, pick, rm.homeTeam, rm.awayTeam)}
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>Odds: </span>
          {pick.odds?.toFixed(2) ?? "—"}
        </div>
        {pFinal != null && pick.pSignal != null && (
          <div>
            <span style={{ color: "var(--muted)" }}>P_signal: </span>
            {pick.pSignal}%
            {pFinalBase != null && tierInfo && tierInfo.appliedBoost !== 0 && (
              <>
                <span style={{ color: "var(--muted)", marginLeft: "0.75rem" }}>P_base: </span>
                {pFinalBase}%
              </>
            )}
            <span style={{ color: "var(--muted)", marginLeft: "0.75rem" }}>Batch risk R_batch: </span>
            {math ? `${(math.rBatch * 100).toFixed(0)}%` : "—"}
            <span style={{ color: "var(--muted)", marginLeft: "0.75rem" }}>P_final: </span>
            <span style={{ color: bandColor, fontWeight: 600 }}>{pFinal}%</span>
          </div>
        )}
        {tierInfo && tierInfo.tierGap > 0 && (
          <div style={{ fontSize: "0.8125rem", marginTop: "0.35rem", color: "var(--accent)" }}>
            Tier gap: {tierInfo.tierGap} → {tierInfo.tierBoostPct > 0 ? `+${tierInfo.tierBoostPct}%` : "0%"} boost
            {tierInfo.appliedBoost !== 0 && (
              <> · Applied: {tierInfo.appliedBoost > 0 ? "+" : ""}{tierInfo.appliedBoost}%
                {tierInfo.higherTierTeam ? ` (${tierInfo.higherTierTeam})` : ""}
                {pFinalBase != null && pFinal != null ? ` · ${pFinalBase}% → ${pFinal}%` : ""}
              </>
            )}
          </div>
        )}
        {pick.dataSampleSize != null && pick.dataSampleSize > 0 && (
          <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            Sample size: {pick.dataSampleSize} data points
          </div>
        )}
        {gameEntry && (
          <div>
            <span style={{ color: "var(--muted)" }}>Judgment: </span>
            {MATCH_JUDGMENT_LABELS[gameEntry.judgment]}
          </div>
        )}
        {pick.judgment && (
          <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.8125rem" }}>{pick.judgment}</p>
        )}
        {pick.learnerWhy && (
          <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--accent)" }}>
            Learner: {pick.learnerWhy}
          </p>
        )}
        {pick.mathSnapshot && (
          <details style={{ marginTop: "0.5rem" }}>
            <summary style={{ cursor: "pointer", fontSize: "0.8125rem", color: accentColor }}>
              Signal breakdown
            </summary>
            <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--muted)" }}>
              <div>
                Signals: E {pick.mathSnapshot.signals.capacityEdge}% · F {pick.mathSnapshot.signals.recentForm}% · H{" "}
                {pick.mathSnapshot.signals.headToHead}% · A {pick.mathSnapshot.signals.yourAccuracy}% · L{" "}
                {pick.mathSnapshot.signals.luckyNudge}%
              </div>
              <div>
                Reliability: E {pick.mathSnapshot.reliability.capacityEdge} · F {pick.mathSnapshot.reliability.recentForm}{" "}
                · H {pick.mathSnapshot.reliability.headToHead} · A {pick.mathSnapshot.reliability.yourAccuracy} · L{" "}
                {pick.mathSnapshot.reliability.luckyNudge}
              </div>
            </div>
          </details>
        )}
      </div>

      {marketComparison.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>All markets compared</div>
          <MarketComparisonTable entries={marketComparison} />
        </div>
      )}

      <FrozenModelOutputs pick={pick} />
      <CorrectScorePanel grid={pick.mathSnapshot?.statLayer?.scoreGrid} label="Correct score (frozen grid)" />
    </div>
  );
}

export function BatchAnalysisDetail({
  batch,
  sourceBatch,
  learnerEnabled = false,
  highlightCombos = false,
  allBatches = [],
  comboSettings,
  analysis = null,
  teamsQuality = null,
  learnerStats = null,
}: BatchAnalysisDetailProps) {
  const recommended = batch.recommended;
  if (!recommended) {
    return <p className="page-sub">No recommendation snapshot for this batch.</p>;
  }

  const math = getMathSnapshot(batch);
  const accentColor = getTierAccentColor(batch.recommendationTier);
  const { summary, matches, gameList } = recommended;
  const sameDateDedupExclusions = summary.exclusions.filter((e) => isSameDateDedupReason(e.reason));

  return (
    <div id="batch-analysis-detail" className="card" style={{ marginBottom: "1.5rem", borderColor: accentColor }}>
      <div style={{ marginBottom: "1rem" }}>
        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: accentColor }}>{recommended.displayName}</div>
        <h3 style={{ fontSize: "1.125rem", margin: "0.25rem 0" }}>{getBatchDisplayId(batch)}</h3>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--muted)" }}>
          {batch.batchName} · Status {batch.recommendationStatus ?? "PENDING"}
          {batch.sourceBatchId ? ` · Source ${batch.sourceBatchId}` : ""}
        </p>
      </div>

      {learnerStats?.correctScoreStats?.rollingTop3Rate != null && (
        <p style={{ margin: "0 0 1rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
          Top-3 correct score hit rate:{" "}
          <strong style={{ color: "inherit" }}>{learnerStats.correctScoreStats.rollingTop3Rate}%</strong>
          {learnerStats.correctScoreStats.overall.sample > 0
            ? ` (last ${Math.min(50, learnerStats.correctScoreStats.overall.sample)} settled matches)`
            : ""}
        </p>
      )}

      <div className="stat-grid" style={{ marginBottom: "1rem" }}>
        <div>
          <div className="stat-label">Matches</div>
          <div className="stat-value" style={{ fontSize: "1.25rem" }}>{summary.matchesIncluded}</div>
        </div>
        <div>
          <div className="stat-label">Combined odds</div>
          <div className="stat-value" style={{ fontSize: "1.25rem" }}>
            {(math?.totalCombinedOdds ?? summary.totalCombinedOdds)?.toFixed(2) ?? "—"}
          </div>
        </div>
        {math?.averagePFinal != null && (
          <div>
            <div className="stat-label">Average P_final</div>
            <div
              className="stat-value"
              style={{
                fontSize: "1.25rem",
                color: CONFIDENCE_BAND_COLORS[confidenceBand(math.averagePFinal)],
              }}
            >
              {math.averagePFinal}%
            </div>
          </div>
        )}
        <div>
          <div className="stat-label">Batch risk</div>
          <div className="stat-value" style={{ fontSize: "1.25rem" }}>{math?.batchRiskScore ?? "—"}</div>
        </div>
      </div>

      {math?.workflowLog && math.workflowLog.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h4 style={{ fontSize: "0.9375rem", marginBottom: "0.5rem" }}>Generation workflow</h4>
          <ol style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
            {math.workflowLog.map((step, i) => (
              <li key={i} style={{ marginBottom: "0.35rem" }}>
                <span style={{ color: "var(--accent)", fontWeight: 600, textTransform: "capitalize" }}>
                  {step.phase.replace(/_/g, " ")}:
                </span>{" "}
                {step.message}
              </li>
            ))}
          </ol>
        </div>
      )}

      {math && (
        <details style={{ marginBottom: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.875rem", color: accentColor }}>
            Batch math snapshot
          </summary>
          <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
            <div>R_odds {(math.rOdds * 100).toFixed(0)}% · R_loss {(math.rLoss * 100).toFixed(0)}% · R_batch {(math.rBatch * 100).toFixed(0)}%</div>
            <div>Lambda: {math.lambda} · Band: {math.batchRiskBand}</div>
            <p style={{ margin: "0.5rem 0 0" }}>{summary.summaryJudgment}</p>
          </div>
        </details>
      )}

      {sameDateDedupExclusions.length > 0 && (
        <p style={{ fontSize: "0.8125rem", color: "var(--warn)", marginBottom: "1rem" }}>
          {sameDateDedupExclusions.length} market(s) skipped due to same-date deduplication.
        </p>
      )}

      {gameList.length > 0 && (
        <div style={{ marginBottom: "1rem" }}>
          <h4 style={{ fontSize: "0.9375rem", marginBottom: "0.5rem" }}>Suggestion engine — game list</h4>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
            All source matches with similarity, judgment, and keep/drop reasons.
          </p>
          {gameList.map((entry) => (
            <GameListEntry key={entry.matchId} entry={entry} />
          ))}
        </div>
      )}

      <h4 style={{ fontSize: "0.9375rem", marginBottom: "0.75rem" }}>Per-match analysis</h4>
      {matches.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No matches in batch.</p>
      ) : (
        matches.map((rm) => {
          const gameEntry = gameList.find((g) => g.matchId === rm.id);
          return (
            <MatchAnalysisBlock
              key={rm.id}
              batch={batch}
              rm={rm}
              gameEntry={gameEntry}
              accentColor={accentColor}
            />
          );
        })
      )}

      {sourceBatch && sourceBatch.matches.length > 0 && (
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: "0.875rem" }}>
            Original source picks
          </summary>
          <div style={{ marginTop: "0.75rem" }}>
            {sourceBatch.matches.map((match: LogMatch) => (
              <div key={match.id} className="card" style={{ marginBottom: "0.5rem" }}>
                <strong>
                  {match.homeTeam} vs {match.awayTeam}
                </strong>
                {(Object.keys(match.predictions) as LogMarketKey[]).map((key) => {
                  const pred = match.predictions[key];
                  if (!pred) return null;
                  return (
                    <div key={key} style={{ fontSize: "0.8125rem", marginTop: "0.35rem" }}>
                      {LOG_MARKET_MAP[key]?.label ?? key}: {pickLabel(key, pred, match.homeTeam, match.awayTeam)} · odds{" "}
                      {pred.odds ?? "—"} · {pred.confidence}%
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </details>
      )}

      {recommended.learnerGenerated && learnerEnabled && (
        <p style={{ fontSize: "0.875rem", marginTop: "1rem", color: "var(--accent)", fontWeight: 600 }}>
          AI Learner overlay applied at generation time.
        </p>
      )}

      {summary.exclusions.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h4 style={{ fontSize: "0.9375rem", color: "var(--warn)", marginBottom: "0.5rem" }}>
            Excluded matches ({summary.exclusions.length})
          </h4>
          {summary.exclusions.map((ex) => (
            <div key={`${ex.matchId}-${ex.reason.slice(0, 20)}`} style={{ fontSize: "0.8125rem", marginBottom: "0.35rem" }}>
              <strong>
                {ex.homeTeam} vs {ex.awayTeam}
              </strong>
              : {ex.reason}
            </div>
          ))}
        </div>
      )}

      <ComboAnalysisSection
        batch={batch}
        allBatches={allBatches.length ? allBatches : [batch]}
        comboSettings={comboSettings ?? loadCombinedOddsSettings()}
        analysis={analysis}
        teamsQuality={teamsQuality}
        learnerStats={learnerStats}
        defaultOpen={highlightCombos}
      />
    </div>
  );
}
