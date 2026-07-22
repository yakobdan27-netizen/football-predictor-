import { SettingsApp } from "@/components/prediction-log/settings-app";
import Link from "next/link";

export default function SettingsPage() {
  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">
        Batch entry preferences and combined-odds engine configuration. Stored locally in your browser.
      </p>
      <p style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link href="/admin/manual-results" style={{ color: "var(--muted)" }}>
          Admin → Manual Results
        </Link>
      </p>
      <SettingsApp />
    </div>
  );
}
