"use client";

/**
 * Admin-visible diagnostic panel for canonicalFixtureEstimate provenance.
 */
import type { CanonicalFixtureEstimate } from "@/lib/prediction-log/canonical-fixture-estimate";

export function FixtureEstimateDiagnostics({
  estimate,
  title = "Estimate diagnostics",
}: {
  estimate: CanonicalFixtureEstimate | null;
  title?: string;
}) {
  if (!estimate) {
    return (
      <div className="alert" role="status" style={{ fontSize: "0.8rem" }}>
        No canonical estimate loaded.
      </div>
    );
  }

  const p = estimate.provenance;
  const d = estimate.diagnostics;
  const seasonsFail =
    p.seasons_used < 11
      ? `seasons_used=${p.seasons_used} (<11 — explain promotion/relegation or fix truncation)`
      : null;

  return (
    <div
      className="card"
      style={{ padding: "0.85rem", fontSize: "0.8rem", marginTop: "0.75rem" }}
    >
      <strong>{title}</strong>
      <div style={{ marginTop: "0.4rem", color: "var(--muted)" }}>
        model {estimate.model_params_version} · ρ={estimate.rho} · tier{" "}
        {estimate.confidence_tier} · source {p.sourceBreakdown}
      </div>
      <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
        <li>
          λ FT home/away: {estimate.lambdas.home.toFixed(3)} /{" "}
          {estimate.lambdas.away.toFixed(3)}
        </li>
        <li>
          λ 1H/2H (team sums): {estimate.lambdas.home_1h.toFixed(3)}+
          {estimate.lambdas.away_1h.toFixed(3)} /{" "}
          {estimate.lambdas.home_2h.toFixed(3)}+
          {estimate.lambdas.away_2h.toFixed(3)}
        </li>
        <li>
          Half sum check: λ1H+λ2H={d.lambda1hPlus2h.toFixed(3)} vs λFT=
          {d.lambdaFt.toFixed(3)} {d.halfSumOk ? "OK" : "INVESTIGATE"}
        </li>
        <li>
          Sample: seasons={p.seasons_used} matches={p.matches_used} ESS=
          {p.ess.toFixed(1)}
        </li>
        <li>
          Blend weights (λ inputs): API {p.api_pct.toFixed(0)}% · Manual/AI{" "}
          {p.manual_pct.toFixed(0)}%
        </li>
        <li>
          Markets: 2H&gt;1H {(estimate.markets.p2h_gt_1h * 100).toFixed(1)}% ·
          O2.5 {(estimate.markets.over25 * 100).toFixed(1)}% · U2.5{" "}
          {(estimate.markets.under25 * 100).toFixed(1)}% · BTTS{" "}
          {(estimate.markets.bttsYes * 100).toFixed(1)}%
        </li>
        <li>
          Coverage: HT{" "}
          {estimate.coverage.ht_pct != null
            ? `${estimate.coverage.ht_pct.toFixed(1)}%`
            : "—"}{" "}
          · corners{" "}
          {estimate.coverage.corners_pct != null
            ? `${estimate.coverage.corners_pct.toFixed(1)}%`
            : "—"}
        </li>
      </ul>
      {seasonsFail && (
        <p style={{ margin: "0.5rem 0 0", color: "var(--warn)" }}>{seasonsFail}</p>
      )}
    </div>
  );
}
