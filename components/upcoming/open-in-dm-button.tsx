"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { UpcomingFixtureRow } from "@/lib/football-api/fetch-upcoming-league";

export function OpenInDmButton({
  row,
  className = "btn btn-secondary",
  label = "Decision Maker",
}: {
  row: UpcomingFixtureRow;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function open() {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/fixtures/open-in-dm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiFixtureId: row.apiFixtureId,
          matchDate: row.matchDate,
          kickoffIso: row.kickoffIso,
          home: row.home,
          away: row.away,
          league: row.league,
          status: row.status,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        batchId?: string;
        apiFixtureId?: number;
      };
      if (!res.ok || !data.batchId) {
        throw new Error(data.error ?? "Could not open Decision Maker");
      }
      router.push(
        `/decision-maker?batch=${encodeURIComponent(data.batchId)}&fixture_id=${data.apiFixtureId ?? row.apiFixtureId}`
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open Decision Maker");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem" }}>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => void open()}
        style={{ fontSize: "0.75rem", padding: "0.3rem 0.5rem" }}
      >
        {busy ? "Opening…" : label}
      </button>
      {err ? (
        <span style={{ fontSize: "0.65rem", color: "var(--warn, #b45309)" }}>{err}</span>
      ) : null}
    </span>
  );
}
