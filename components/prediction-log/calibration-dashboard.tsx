"use client";

import type { GlobalCalibrationReport } from "@/lib/prediction-log/global-calibration";

interface CalibrationDashboardProps {
  report: GlobalCalibrationReport;
}

export function CalibrationDashboard({ report }: CalibrationDashboardProps) {
  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>Global calibration</h3>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", color: "var(--muted)" }}>
        {report.note}
      </p>
      {report.sampleSize === 0 ? null : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: "0.5rem",
              marginBottom: "0.75rem",
            }}
          >
            <div>
              <div className="stat-value" style={{ fontSize: "1.25rem" }}>
                {report.sampleSize}
              </div>
              <div className="stat-label">Scored picks</div>
            </div>
            <div>
              <div className="stat-value" style={{ fontSize: "1.25rem" }}>
                {report.overallClaimedPct != null ? `${report.overallClaimedPct}%` : "—"}
              </div>
              <div className="stat-label">Avg claimed</div>
            </div>
            <div>
              <div className="stat-value" style={{ fontSize: "1.25rem" }}>
                {report.overallHitRatePct != null ? `${report.overallHitRatePct}%` : "—"}
              </div>
              <div className="stat-label">Actual hit rate</div>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Claimed bin</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Avg claimed</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Hit rate</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>n</th>
                  <th style={{ padding: "0.35rem 0.5rem" }}>Gap</th>
                </tr>
              </thead>
              <tbody>
                {report.bins.map((b) => (
                  <tr key={b.label} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.35rem 0.5rem" }}>{b.label}</td>
                    <td style={{ padding: "0.35rem 0.5rem" }}>{b.claimedPct}%</td>
                    <td style={{ padding: "0.35rem 0.5rem" }}>
                      {b.hitRatePct != null ? `${b.hitRatePct}%` : "—"}
                    </td>
                    <td style={{ padding: "0.35rem 0.5rem" }}>{b.count}</td>
                    <td
                      style={{
                        padding: "0.35rem 0.5rem",
                        color:
                          b.gapPct == null
                            ? "var(--muted)"
                            : b.gapPct < -5
                              ? "var(--danger)"
                              : b.gapPct > 5
                                ? "var(--accent)"
                                : "var(--muted)",
                      }}
                    >
                      {b.gapPct == null
                        ? "—"
                        : `${b.gapPct > 0 ? "+" : ""}${b.gapPct}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
