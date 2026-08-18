import Link from "next/link";
import { isApiFootballConfigured } from "@/lib/apiClient";

export function DataSourceBanner() {
  const apiEnabled = isApiFootballConfigured();

  return (
    <div
      className="card"
      style={{
        marginBottom: "1rem",
        padding: "0.65rem 1rem",
        borderColor: "var(--border)",
        background: apiEnabled
          ? "rgba(59, 130, 246, 0.06)"
          : "rgba(76, 175, 80, 0.06)",
        fontSize: "0.8125rem",
        color: "var(--muted)",
      }}
    >
      {apiEnabled ? (
        <>
          Uses API-Football for fixtures, results, stats, and hist backfill.
          Prediction Log entry and manual overrides always available.{" "}
          <Link href="/settings" style={{ color: "var(--accent)" }}>
            Settings
          </Link>
        </>
      ) : (
        <>
          Manual entry mode — set <code>APISPORTS_KEY</code> to enable
          API-Football sync, live fixtures, and hist backfill.{" "}
          <Link href="/settings" style={{ color: "var(--accent)" }}>
            Settings
          </Link>
        </>
      )}
    </div>
  );
}
