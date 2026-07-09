"use client";

import type { ComparisonResult } from "@/lib/prediction-log/club-comparison";
import { LOG_MARKET_MAP } from "@/lib/prediction-log/markets-config";
import { luckyInfluenceNote } from "@/lib/prediction-log/lucky-numbers";
import { MATCH_JUDGMENT_LABELS } from "@/lib/prediction-log/recommendation-config";
import {
  confidenceBand,
  confidenceBandLabel,
  CONFIDENCE_BAND_COLORS,
} from "@/lib/prediction-log/master-probability-config";
import { isSameDateDedupReason } from "@/lib/prediction-log/same-date-market-dedup";
import type { LogMarketKey, PredictionBatch } from "@/lib/prediction-log/types";

interface RecommendedBatchViewProps {
  batch: PredictionBatch;
  luckyNumbers?: number[];
  h2hByMatch?: Record<string, ComparisonResult>;
  accentColor?: string;
}

export function RecommendedBatchView({
  batch,
  luckyNumbers = [],
  h2hByMatch = {},
  accentColor = "var(--accent)",
}: RecommendedBatchViewProps) {
  const recommended = batch.recommended;
  if (!recommended) return null;

  const { summary, matches, gameList } = recommended;
  const math = recommended.mathSnapshot;
  const displayCount = summary.matchesIncluded;
  const displayOdds = math?.totalCombinedOdds ?? summary.totalCombinedOdds;
  const batchConfidence = math?.averagePFinal ?? summary.averagePFinal ?? null;
  const sameDateDedupExclusions = summary.exclusions.filter((entry) =>
    isSameDateDedupReason(entry.reason)
  );

  return (
    <div className="card" style={{ marginBottom: "1rem", borderColor: accentColor }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: accentColor, marginBottom: "0.25rem" }}>
            {recommended.displayName}
          </div>
          <h3 style={{ fontSize: "1rem", margin: 0 }}>{batch.batchName}</h3>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
            Batch ID: <strong style={{ color: "inherit" }}>{batch.recommendationId ?? batch.id}</strong>
            {" · "}
            Status: <strong style={{ color: "inherit" }}>{batch.recommendationStatus ?? "PENDING"}</strong>
            {batch.sourceBatchId ? (
              <>
                {" · "}
                Source: <strong style={{ color: "inherit" }}>{batch.sourceBatchId}</strong>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <div className="stat-grid">
          <div>
            <div className="stat-label">Matches included</div>
            <div className="stat-value" style={{ fontSize: "1.25rem" }}>
              {displayCount}
            </div>
          </div>
          <div>
            <div className="stat-label">Combined odds</div>
            <div className="stat-value" style={{ fontSize: "1.25rem" }}>
              {displayOdds?.toFixed(2) ?? "—"}
            </div>
          </div>
          {batchConfidence != null && (
            <div>
              <div className="stat-label">Average P_final</div>
              <div
                className="stat-value"
                style={{
                  fontSize: "1.25rem",
                  color: CONFIDENCE_BAND_COLORS[confidenceBand(batchConfidence)],
                }}
              >
                {batchConfidence}%
              </div>
            </div>
          )}
          <div>
            <div className="stat-label">Batch risk score</div>
            <div className="stat-value" style={{ fontSize: "1.25rem", textTransform: "capitalize" }}>
              {math?.batchRiskScore ?? "—"}
            </div>
          </div>
        </div>
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.875rem", color: "var(--muted)" }}>
          {summary.summaryJudgment}
        </p>
        {sameDateDedupExclusions.length > 0 && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--warn)" }}>
            {sameDateDedupExclusions.length} market(s) skipped on this slip because the same fixture
            and market were already recommended earlier today.
          </p>
        )}
        {summary.clubInsight && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
            {summary.clubInsight}
          </p>
        )}
      </div>

      <h3 style={{ fontSize: "1rem", margin: "1rem 0 0.75rem" }}>Recommended games</h3>
      {matches.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No matches in batch.</p>
      ) : (
        matches.map((match) => {
          const gameEntry = gameList.find((g) => g.matchId === match.id);
          const acceptedPick = Object.entries(match.predictions).find(
            ([, p]) => p && p.action !== "remove"
          ) as [LogMarketKey, (typeof match.predictions)[LogMarketKey]] | undefined;

          if (!acceptedPick || !acceptedPick[1]) return null;
          const [marketKey, pick] = acceptedPick;
          const luckyNote =
            pick.odds != null ? luckyInfluenceNote(pick.odds, luckyNumbers) : null;
          const h2h = h2hByMatch[match.id];
          const pFinal = recommended.mathSnapshot?.pFinalByMatch[match.id] ?? pick.pFinal;
          const pFinalBase =
            recommended.mathSnapshot?.pFinalBaseByMatch?.[match.id] ??
            recommended.mathSnapshot?.tierInfoByMatch?.[match.id]?.pFinalBase;
          const tierInfo = recommended.mathSnapshot?.tierInfoByMatch?.[match.id];
          const band = pFinal != null ? confidenceBand(pFinal) : null;
          const bandColor = band ? CONFIDENCE_BAND_COLORS[band] : undefined;

          return (
            <div
              key={match.id}
              className="card"
              style={{ marginBottom: "0.75rem", background: "rgba(255,255,255,0.01)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <strong>
                  {match.homeTeam}
                  {tierInfo?.homeTier ? ` (${tierInfo.homeTier})` : ""} vs {match.awayTeam}
                  {tierInfo?.awayTier ? ` (${tierInfo.awayTier})` : ""}
                </strong>
                {pFinal != null && (
                  <span
                    style={{
                      fontSize: "0.8125rem",
                      fontWeight: 700,
                      color: bandColor,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {pFinal}% — {confidenceBandLabel(band!)}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
                <div>
                  <span style={{ color: "var(--muted)" }}>Market: </span>
                  {LOG_MARKET_MAP[marketKey]?.label ?? marketKey} — {pick.prediction}
                  {pick.line != null && ` (${pick.line})`}
                </div>
                <div>
                  <span style={{ color: "var(--muted)" }}>Odds: </span>
                  {pick.odds?.toFixed(2) ?? "—"}
                </div>
                {pFinal != null && pick.pSignal != null ? (
                  <div>
                    <span style={{ color: "var(--muted)" }}>P_signal: </span>
                    {pick.pSignal}%
                    {pFinalBase != null && tierInfo && tierInfo.appliedBoost !== 0 ? (
                      <>
                        <span style={{ color: "var(--muted)", marginLeft: "0.75rem" }}>P_base: </span>
                        {pFinalBase}%
                      </>
                    ) : null}
                    <span style={{ color: "var(--muted)", marginLeft: "0.75rem" }}>P_final: </span>
                    <span style={{ color: bandColor, fontWeight: 600 }}>{pFinal}%</span>
                  </div>
                ) : (
                  <div>
                    <span style={{ color: "var(--muted)" }}>Confidence: </span>
                    {pick.confidence}%
                  </div>
                )}
                {tierInfo && tierInfo.tierGap > 0 && (
                  <div style={{ fontSize: "0.8125rem", marginTop: "0.35rem", color: "var(--accent)" }}>
                    Tier gap: {tierInfo.tierGap} level{tierInfo.tierGap === 1 ? "" : "s"} →{" "}
                    {tierInfo.tierBoostPct > 0 ? `+${tierInfo.tierBoostPct}%` : "0%"} boost
                    {tierInfo.appliedBoost !== 0 && (
                      <>
                        {" "}
                        · Applied: {tierInfo.appliedBoost > 0 ? "+" : ""}
                        {tierInfo.appliedBoost}%
                        {tierInfo.higherTierTeam ? ` (${tierInfo.higherTierTeam} advantage)` : ""}
                      </>
                    )}
                    {pFinalBase != null && pFinal != null && tierInfo.appliedBoost !== 0 && (
                      <>
                        {" "}
                        · {pFinalBase}% → {pFinal}%
                      </>
                    )}
                  </div>
                )}
                {pick.mathSnapshot?.statLayer && (
                  <div style={{ fontSize: "0.75rem", color: "var(--accent)", marginTop: "0.35rem" }}>
                    P_stat {pick.mathSnapshot.statLayer.pStat}% (DC {pick.mathSnapshot.statLayer.pDc}% · ML{" "}
                    {pick.mathSnapshot.statLayer.pMl}%) · P_custom {pick.mathSnapshot.statLayer.pCustom}%
                  </div>
                )}
                {pick.dataSampleSize != null && pick.dataSampleSize > 0 && (
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    Based on {pick.dataSampleSize} data points
                  </div>
                )}
                {gameEntry && (
                  <div>
                    <span style={{ color: "var(--muted)" }}>Judgment: </span>
                    {MATCH_JUDGMENT_LABELS[gameEntry.judgment]}
                  </div>
                )}
                <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.8125rem" }}>
                  {pick.judgment}
                </p>
                {pick.learnerWhy && (
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--accent)" }}>
                    Learner: {pick.learnerWhy}
                  </p>
                )}
                {h2h && (
                  <p
                    style={{
                      margin: "0.35rem 0 0",
                      fontSize: "0.8125rem",
                      color: h2h.lowDataWarning ? "var(--warn)" : "var(--muted)",
                    }}
                  >
                    Head-to-head: {h2h.confidence}% confidence
                    {h2h.lowDataWarning ? " (low data)" : ""} — {h2h.judgement.slice(0, 120)}
                    {h2h.judgement.length > 120 ? "…" : ""}
                  </p>
                )}
                {luckyNote && (
                  <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--accent)" }}>
                    {luckyNote}
                  </p>
                )}

                {pick.mathSnapshot && (
                  <details style={{ marginTop: "0.5rem" }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.8125rem", color: accentColor }}>
                      Show math snapshot
                    </summary>
                    <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--muted)" }}>
                      <div>
                        Signals: E {pick.mathSnapshot.signals.capacityEdge}% · F{" "}
                        {pick.mathSnapshot.signals.recentForm}% · H {pick.mathSnapshot.signals.headToHead}% ·
                        A {pick.mathSnapshot.signals.yourAccuracy}% · L {pick.mathSnapshot.signals.luckyNudge}%
                      </div>
                      <div>
                        Reliability: E {pick.mathSnapshot.reliability.capacityEdge} · F{" "}
                        {pick.mathSnapshot.reliability.recentForm} · H{" "}
                        {pick.mathSnapshot.reliability.headToHead} · A{" "}
                        {pick.mathSnapshot.reliability.yourAccuracy} · L{" "}
                        {pick.mathSnapshot.reliability.luckyNudge}
                      </div>
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })
      )}

      {math && (
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600, color: accentColor }}>
            Show full batch math snapshot
          </summary>
          <div style={{ marginTop: "0.75rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
            <div>Total odds: {math.totalCombinedOdds?.toFixed(2) ?? "—"}</div>
            <div>
              Risk score: {math.batchRiskScore} · R_odds {(math.rOdds * 100).toFixed(0)}% · R_loss{" "}
              {(math.rLoss * 100).toFixed(0)}% · R_batch {(math.rBatch * 100).toFixed(0)}%
            </div>
            <div>Average P_final: {math.averagePFinal ?? "—"}%</div>
            <div>Lambda used: {math.lambda}</div>
          </div>
        </details>
      )}

      {summary.exclusions.length > 0 && (
        <>
          <h3 style={{ fontSize: "1rem", margin: "1.5rem 0 0.75rem", color: "var(--warn)" }}>
            Removed for risk
          </h3>
          {summary.exclusions.map((ex) => (
            <div
              key={ex.matchId}
              className="card"
              style={{ marginBottom: "0.5rem", borderColor: "var(--warn)" }}
            >
              <strong>
                {ex.homeTeam} vs {ex.awayTeam}
              </strong>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
                {ex.reason}
              </p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
