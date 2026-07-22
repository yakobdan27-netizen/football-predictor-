"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminUnlockForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Unlock failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "2rem auto" }}>
      <h1 className="page-title" style={{ fontSize: "1.25rem" }}>
        Admin unlock
      </h1>
      <p className="page-sub">
        Enter the admin password (<code>ADMIN_SECRET</code>) to continue.
      </p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.75rem" }}>
        <div>
          <label className="label" htmlFor="admin-pw">
            Password
          </label>
          <input
            id="admin-pw"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <p style={{ color: "var(--danger)", margin: 0, fontSize: "0.875rem" }}>{error}</p>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || !password}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
