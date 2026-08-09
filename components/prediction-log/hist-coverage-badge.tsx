"use client";

import { useEffect, useState } from "react";

type CoverageSummary = {
  full: number;
  partial: number;
  missing: number;
  total: number;
  inventoryPass?: number;
  providerHoles?: number;
};

/**
 * Thin inventory badge — honest FAIL state until 66 buckets pass.
 */
export function HistCoverageBadge() {
  const [summary, setSummary] = useState<CoverageSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/hist/coverage")
      .then(async (r) => {
        if (!r.ok) return;
        const data = (await r.json()) as {
          ok?: boolean;
          summary?: CoverageSummary & { coreOnly?: number };
        };
        if (cancelled || !data.summary) return;
        setSummary({
          full: data.summary.full,
          partial: data.summary.partial,
          missing: data.summary.missing,
          total: data.summary.total,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!summary) return null;
  const inv = summary.inventoryPass ?? summary.full;
  const pass = inv === 66;
  return (
    <div
      className="alert"
      role="status"
      style={{
        fontSize: "0.75rem",
        marginBottom: "0.75rem",
        borderColor: pass ? "var(--ok, #15803d)" : "var(--warn)",
      }}
    >
      Hist inventory: {inv}/66 pass · {summary.full} full · {summary.partial}{" "}
      partial · {summary.missing} missing
      {summary.providerHoles ? ` · ${summary.providerHoles} provider holes` : ""}{" "}
      — {pass ? "PASS" : "FAIL (gap backfill pending)"}
    </div>
  );
}
