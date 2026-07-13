"use client";

import {
  buildMatchSummaryRows,
  formatBetterAlternativeLine,
  getBatchDisplayId,
  getMathSnapshot,
  getProfessionalForMatch,
  getProfessionalSummary,
  getSelectedPickForMatch,
  valueTierColor,
  valueTierLabel,
} from "@/lib/prediction-log/snapshot-readers";
import { LOG_MARKET_MAP, pickOptionsForMarket } from "@/lib/prediction-log/markets-config";
import { pickCommentEmoji, pickCommentTitle } from "@/lib/prediction-log/pick-comment";
import { loadRecommendationSettings } from "@/lib/prediction-log/storage";
import { suggestStake } from "@/lib/prediction-log/strategy-rules";
import { CorrectScoreOneLiner } from "./correct-score-panel";
import type {
  LogMarketKey,
  LogMatch,
  PredictionBatch,
} from "@/lib/prediction-log/types";

interface UnifiedRecommendationCardProps {
  batch: PredictionBatch;
  /** The user-filled batch this recommendation was generated from. */
  sourceBatch?: PredictionBatch | null;
}

const ACCENT = "#5aa0ff";

function labelForPick(
  marketKey: LogMarketKey,
  prediction: string,
  line: number | undefined,
  homeTeam: string,
  awayTeam: string
): string {
  const marketLabel = LOG_MARKET_MAP[marketKey]?.label ?? marketKey;
  const opts = pickOptionsForMarket(marketKey, homeTeam, awayTeam, line);
  const found = opts.find((o) => o.value === prediction);
  const pickLabel = found?.label ?? (line != null ? `${prediction} ${line}` : prediction);
  return `${marketLabel} — ${pickLabel}`;
}

/** The user's original pick(s) for a match, drawn from the source batch. */
function userPickLabel(sourceMatch: LogMatch | undefined): string | null {
  if (!sourceMatch) return null;
  const entries = Object.entries(sourceMatch.predictions).filter(
    ([, p]) => p && p.prediction
  ) as [LogMarketKey, NonNullable<LogMatch["predictions"][LogMarketKey]>][];
  if (entries.length === 0) return null;
  return entries
    .map(([key, pick]) =>
      labelForPick(key, pick.prediction, pick.line, sourceMatch.homeTeam, sourceMatch.awayTeam)
    )
    .join(", ");
}

export function UnifiedRecommendationCard({
  batch,
  sourceBatch,
}: UnifiedRecommendationCardProps) {
  const recommended = batch.recommended;
  if (!recommended) return null;

  const math = getMathSnapshot(batch);
  const batchId = getBatchDisplayId(batch);
  const matchRows = buildMatchSummaryRows(batch, recommended);
  const displayCount = recommended.summary.matchesIncluded;
  const combinedOdds = math?.totalCombinedOdds ?? recommended.summary.totalCombinedOdds;
  const combinedConfidence = math?.averagePFinal ?? recommended.summary.averagePFinal ?? null;
  const exclusions = recommended.summary.exclusions ?? [];

  const bs = loadRecommendationSettings().bankrollStrategy;
  const stake = suggestStake({
    settings: bs,
    pSignal: combinedConfidence,
    odds: null,
    tier: "balanced",
  });

  return (
    <div className="card" style={{ borderColor: ACCENT }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: ACCENT, marginBottom: "0.25rem" }}>
            {recommended.displayName}
          </div>
          <h3 style={{ fontSize: "1.125rem", margin: 0 }}>{batchId}</h3>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.8125rem", color: "var(--muted)" }}>
            {displayCount} match{displayCount === 1 ? "" : "es"}
            {combinedConfidence != null && (
              <>
                {" · "}Combined confidence{" "}
                <strong style={{ color: "inherit" }}>{combinedConfidence}%</strong>
              </>
            )}
            {combinedOdds != null && (
              <>
                {" · "}Combined odds{" "}
                <strong style={{ color: "inherit" }}>{combinedOdds.toFixed(2)}</strong>
              </>
            )}
            {stake.suggested != null && (
              <>
                {" · "}Suggested stake{" "}
                <strong style={{ color: "inherit" }} title={stake.reason}>
                  {stake.suggested}
                </strong>
              </>
            )}
          </p>
        </div>
      </div>

      <p style={{ margin: "0.75rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
        Guidance only — every match stays in your slip. Nothing here blocks a bet.
      </p>

      <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
        {matchRows.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>No matches qualified for this recommendation.</p>
        ) : (
          matchRows.map((row) => {
            const selected = getSelectedPickForMatch(
              recommended.matches.find((m) => m.id === row.matchId)!
            );
            const sourceMatch = sourceBatch?.matches.find((m) => m.id === row.matchId);
            const userLabel = userPickLabel(sourceMatch);
            const logMatch = batch.matches.find((m) => m.id === row.matchId);
            const csSnapshot = logMatch?.correctScoreSnapshot?.mostLikely;

            const alt = row.betterAlternative;
            const altLine = formatBetterAlternativeLine(alt);
            const userMatchesSystem =
              userLabel != null &&
              selected != null &&
              userLabel.includes(LOG_MARKET_MAP[selected.marketKey]?.label ?? selected.marketKey);

            const comment = row.pickComment;
            const commentColor =
              comment?.label === "good"
                ? "var(--accent)"
                : comment?.label === "risky"
                  ? "var(--warn)"
                  : comment?.label === "avoid"
                    ? "var(--danger)"
                    : "var(--muted)";

            return (
              <div
                key={row.matchId}
                style={{
                  padding: "0.75rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.01)",
                }}
              >
                <strong style={{ display: "block", marginBottom: "0.5rem" }}>
                  {row.homeTeam} vs {row.awayTeam}
                </strong>

                <div style={{ fontSize: "0.875rem", display: "grid", gap: "0.35rem" }}>
                  {/* 1. Correct score */}
                  <div>
                    <span style={{ color: "var(--muted)" }}>Correct score: </span>
                    {csSnapshot ? (
                      <strong>
                        {csSnapshot.home}-{csSnapshot.away}{" "}
                        <span style={{ fontWeight: 400, color: "var(--muted)" }}>
                          ({csSnapshot.probPct}%)
                        </span>
                      </strong>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>
                        Not enough data yet — one club lacks sufficient match history.
                      </span>
                    )}
                  </div>

                  {/* 2. Better market option */}
                  <div>
                    {userMatchesSystem || altLine.isOptimal ? (
                      <span style={{ color: "var(--accent)" }}>
                        Your pick is already the strongest market for this match.
                      </span>
                    ) : (
                      <span>
                        <span style={{ color: "var(--muted)" }}>You picked: </span>
                        {userLabel ?? row.selectedMarketLabel}
                        <span style={{ color: "var(--muted)" }}> → Better option: </span>
                        <span style={{ color: "var(--warn)" }}>{altLine.text}</span>
                      </span>
                    )}
                  </div>

                  {/* 3. Short reason */}
                  {comment ? (
                    <div style={{ color: commentColor, fontSize: "0.8125rem" }}>
                      {pickCommentEmoji(comment.label)} {pickCommentTitle(comment.label)}
                      <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: "0.35rem" }}>
                        — {comment.message}
                      </span>
                    </div>
                  ) : null}

                  {/* 4. Professional read (price-aware) */}
                  {(() => {
                    const pro = getProfessionalForMatch(batch, row.matchId);
                    if (!pro) return null;
                    return (
                      <div
                        style={{
                          marginTop: "0.15rem",
                          paddingTop: "0.4rem",
                          borderTop: "1px dashed var(--border)",
                          fontSize: "0.8125rem",
                        }}
                      >
                        <span style={{ color: "var(--muted)" }}>Pro read: </span>
                        <span style={{ color: valueTierColor(pro.valueTier), fontWeight: 600 }}>
                          {valueTierLabel(pro.valueTier)}
                        </span>
                        {pro.hasPrice && (
                          <span style={{ color: "var(--muted)" }}>
                            {"  ·  "}Edge{" "}
                            <strong style={{ color: "var(--text)" }}>
                              {pro.edgePct >= 0 ? "+" : ""}
                              {pro.edgePct} pts
                            </strong>
                            {"  ·  "}EV{" "}
                            <strong style={{ color: pro.evPerUnit >= 0 ? "#4fb477" : "var(--warn)" }}>
                              {pro.evPerUnit >= 0 ? "+" : ""}
                              {(pro.evPerUnit * 100).toFixed(0)}%
                            </strong>
                            {"  ·  "}Models{" "}
                            <strong style={{ color: "var(--text)" }}>{pro.agreementLabel}</strong>
                          </span>
                        )}
                        <div style={{ color: "var(--muted)", marginTop: "0.15rem" }}>{pro.verdict}</div>
                      </div>
                    );
                  })()}
                </div>

                {!csSnapshot ? null : <CorrectScoreOneLiner snapshot={csSnapshot} />}
              </div>
            );
          })
        )}
      </div>

      {/* Footer: one best combined prediction */}
      <div
        style={{
          marginTop: "1rem",
          padding: "0.85rem",
          borderRadius: "8px",
          border: `1px solid ${ACCENT}`,
          background: "rgba(90,160,255,0.06)",
        }}
      >
        <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: ACCENT, marginBottom: "0.5rem" }}>
          BEST COMBINED PREDICTION
        </div>
        {recommended.matches.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.8125rem" }}>
            No legs qualified for a combined slip.
          </p>
        ) : (
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.1rem", fontSize: "0.8125rem" }}>
            {recommended.matches.map((rm) => {
              const pick = getSelectedPickForMatch(rm);
              if (!pick) return null;
              const marketLabel = LOG_MARKET_MAP[pick.marketKey]?.label ?? pick.marketKey;
              const oddsLabel = pick.pick.odds != null ? ` @ ${pick.pick.odds.toFixed(2)}` : "";
              return (
                <li key={rm.id} style={{ marginBottom: "0.2rem" }}>
                  {rm.homeTeam} vs {rm.awayTeam}: <strong>{marketLabel}</strong>
                  {oddsLabel}
                </li>
              );
            })}
          </ul>
        )}
        <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
          {combinedConfidence != null && (
            <span>
              Combined confidence:{" "}
              <strong style={{ color: "var(--text)" }}>{combinedConfidence}%</strong>
              {"  ·  "}
            </span>
          )}
          {combinedOdds != null && (
            <span>
              Combined odds:{" "}
              <strong style={{ color: "var(--text)" }}>{combinedOdds.toFixed(2)}</strong>
            </span>
          )}
        </div>

        {(() => {
          const slip = getProfessionalSummary(batch);
          if (!slip || slip.comboEvPerUnit == null) return null;
          return (
            <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem" }}>
              <span style={{ color: "var(--muted)" }}>Professional value: </span>
              <strong style={{ color: slip.comboEvPerUnit >= 0 ? "#4fb477" : "var(--warn)" }}>
                Slip EV {slip.comboEvPerUnit >= 0 ? "+" : ""}
                {(slip.comboEvPerUnit * 100).toFixed(0)}%
              </strong>
              <span style={{ color: "var(--muted)" }}>
                {"  ·  "}
                {slip.valueLegs}/{slip.legs} legs with an edge
                {slip.avgEdgePct != null && (
                  <>
                    {"  ·  "}avg edge {slip.avgEdgePct >= 0 ? "+" : ""}
                    {slip.avgEdgePct} pts
                  </>
                )}
              </span>
              <div style={{ color: "var(--muted)", marginTop: "0.15rem" }}>{slip.headline}</div>
            </div>
          );
        })()}

        {exclusions.length > 0 && (
          <div style={{ marginTop: "0.6rem", fontSize: "0.75rem", color: "var(--muted)" }}>
            <span style={{ fontWeight: 600 }}>Left out:</span>
            <ul style={{ margin: "0.2rem 0 0", paddingLeft: "1.1rem" }}>
              {exclusions.map((ex) => (
                <li key={`${ex.matchId}-${ex.reason}`}>
                  {ex.homeTeam} vs {ex.awayTeam} — {ex.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
