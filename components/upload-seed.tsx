"use client";

import { useState } from "react";

export function UploadCsv({ onSuccess }: { onSuccess?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setMessage(null);
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      const parts = [`Imported ${data.imported} matches`];
      const r = data.report;
      if (r) {
        if (r.duplicatesRemoved) parts.push(`${r.duplicatesRemoved} duplicates removed`);
        if (r.teamNamesStandardized) parts.push(`${r.teamNamesStandardized} names standardized`);
        if (r.droppedInvalid) parts.push(`${r.droppedInvalid} invalid rows dropped`);
        if (r.droppedIncomplete) parts.push(`${r.droppedIncomplete} incomplete rows dropped`);
      }
      setMessage({ type: "ok", text: parts.join(" · ") });
      onSuccess?.();
    } catch (err) {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      <label className="btn btn-secondary btn-full" style={{ cursor: "pointer" }}>
        {loading ? "Uploading…" : "Upload CSV"}
        <input
          type="file"
          accept=".csv"
          onChange={handleUpload}
          disabled={loading}
          style={{ display: "none" }}
        />
      </label>
      {message && (
        <div
          className={`alert ${message.type === "ok" ? "alert-success" : "alert-error"}`}
          style={{ marginTop: "0.75rem" }}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}

export function SeedButton({ onSuccess }: { onSuccess?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function seed() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Seed failed");
      setMessage(
        data.seeded
          ? `Seeded ${data.seeded} demo matches`
          : data.message ?? "Done"
      );
      onSuccess?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        className="btn btn-primary btn-full"
        onClick={seed}
        disabled={loading}
      >
        {loading ? "Seeding…" : "Load demo data"}
      </button>
      {message && (
        <div className="alert alert-info" style={{ marginTop: "0.75rem" }}>
          {message}
        </div>
      )}
    </div>
  );
}
