"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ADMIN_USERS_UNGUARDED_NOTICE } from "@/lib/bets/constants";

type AdminUser = {
  id: number;
  phone: string;
  displayName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  totalSlips: number;
  submitted: number;
  won: number;
  lost: number;
  voided: number;
  netResult: number;
};

type Summary = {
  totalUsers: number;
  totalSlips: number;
  open: number;
  won: number;
  lost: number;
};

type UserSlip = {
  id: number;
  createdAt: string;
  slipType: string;
  stake: number;
  totalOdd: number;
  potentialReturn: number;
  status: string;
  note: string | null;
  selections: Array<{
    id: number;
    eventLabel: string;
    marketLabel: string;
    chosenLabel: string;
    chosenOdd: number;
    result: string;
  }>;
};

type UserDetail = {
  user: {
    id: number;
    phone: string;
    displayName: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  stats: {
    totalSlips: number;
    submitted: number;
    won: number;
    lost: number;
    voided: number;
    winRate: number | null;
    avgStake: number;
    netResult: number;
    topLeagues: Array<{ label: string; count: number }>;
    topMarkets: Array<{ label: string; count: number }>;
  };
  slips: UserSlip[];
};

function fmtNet(n: number) {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

export function AdminUsersApp({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPhone = searchParams.get("phone") ?? "";
  const initialUserId = searchParams.get("userId");

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [q, setQ] = useState(initialPhone);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minSlips, setMinSlips] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(
    initialUserId && Number.isFinite(Number(initialUserId))
      ? Number(initialUserId)
      : null
  );
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailStatus, setDetailStatus] = useState("");
  const [detailFrom, setDetailFrom] = useState("");
  const [detailTo, setDetailTo] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [expandedSlips, setExpandedSlips] = useState<Set<number>>(new Set());
  const [phoneRevealed, setPhoneRevealed] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (minSlips.trim()) params.set("minSlips", minSlips.trim());
      const res = await fetch(`/api/ext/admin/users?${params}`, {
        headers: { "x-admin-users-slug": slug },
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        users?: AdminUser[];
        summary?: Summary;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to load");
        setUsers([]);
      } else {
        setUsers(data.users ?? []);
        setSummary(data.summary ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [slug, q, from, to, minSlips]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(
    async (userId: number) => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const params = new URLSearchParams();
        if (detailStatus) params.set("status", detailStatus);
        if (detailFrom) params.set("from", detailFrom);
        if (detailTo) params.set("to", detailTo);
        const qs = params.toString();
        const res = await fetch(
          `/api/ext/admin/users/${userId}${qs ? `?${qs}` : ""}`,
          { headers: { "x-admin-users-slug": slug } }
        );
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
        } & Partial<UserDetail>;
        if (!res.ok || !data.ok || !data.user || !data.stats || !data.slips) {
          setDetailError(data.error ?? "Failed to load history");
          setDetail(null);
        } else {
          setDetail({
            user: data.user,
            stats: data.stats,
            slips: data.slips,
          });
        }
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : "Failed to load history");
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [slug, detailStatus, detailFrom, detailTo]
  );

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Deep-link: ?phone= opens matching user when list loads
  useEffect(() => {
    if (selectedId != null || !initialPhone.trim() || !users.length) return;
    const needle = initialPhone.trim().toLowerCase();
    const match = users.find(
      (u) =>
        u.phone.toLowerCase() === needle ||
        u.phone.toLowerCase().includes(needle)
    );
    if (match) setSelectedId(match.id);
  }, [users, initialPhone, selectedId]);

  function openUser(id: number) {
    setSelectedId(id);
    setExpandedSlips(new Set());
    const params = new URLSearchParams(searchParams.toString());
    params.set("userId", String(id));
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("userId");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

  function toggleSlip(id: number) {
    setExpandedSlips((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePhone(id: number) {
    setPhoneRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function maskPhone(phone: string, revealed: boolean) {
    if (revealed || phone.length <= 4) return phone;
    return `${"•".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", paddingBottom: "2rem" }}>
      <div className="alert alert-error" role="status">
        {ADMIN_USERS_UNGUARDED_NOTICE}
      </div>

      <h1 className="page-title" style={{ fontSize: "1.35rem" }}>
        External users
      </h1>
      {summary && (
        <p className="page-sub">
          {summary.totalUsers} users · {summary.totalSlips} slips · {summary.open}{" "}
          open · {summary.won}W / {summary.lost}L
        </p>
      )}
      <p className="page-sub" style={{ fontSize: "0.75rem" }}>
        Users admin URL uses ADMIN_USERS_SLUG (separate from slips admin).
      </p>

      {selectedId == null ? (
        <>
          <div
            className="card"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              alignItems: "flex-end",
              padding: "0.75rem",
              marginBottom: "1rem",
            }}
          >
            <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
              Phone / name
              <input
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ display: "block", marginTop: 2, width: "12rem" }}
              />
            </label>
            <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
              Last seen from
              <input
                className="input"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                style={{ display: "block", marginTop: 2 }}
              />
            </label>
            <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
              To
              <input
                className="input"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={{ display: "block", marginTop: 2 }}
              />
            </label>
            <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
              Min slips
              <input
                className="input"
                type="number"
                min={0}
                value={minSlips}
                onChange={(e) => setMinSlips(e.target.value)}
                style={{ display: "block", marginTop: 2, width: "5rem" }}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? "Loading…" : "Filter"}
            </button>
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: "0.75rem" }}>
              {error}
            </div>
          )}

          <div className="admin-users-desktop" style={{ overflowX: "auto" }}>
            <table
              className="table mobile-stack-table"
              style={{ width: "100%", fontSize: "0.8rem" }}
            >
              <thead>
                <tr>
                  <th>Phone</th>
                  <th>Name</th>
                  <th>First</th>
                  <th>Last</th>
                  <th>Slips</th>
                  <th>W/L/V/P</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => openUser(u.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td
                      data-label="Phone"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePhone(u.id);
                      }}
                    >
                      {maskPhone(u.phone, phoneRevealed.has(u.id))}
                    </td>
                    <td data-label="Name">{u.displayName ?? "—"}</td>
                    <td data-label="First">
                      {new Date(u.firstSeenAt).toLocaleDateString()}
                    </td>
                    <td data-label="Last">
                      {new Date(u.lastSeenAt).toLocaleDateString()}
                    </td>
                    <td data-label="Slips">{u.totalSlips}</td>
                    <td data-label="W/L/V/P">
                      {u.won}/{u.lost}/{u.voided}/{u.submitted}
                    </td>
                    <td data-label="Net">{fmtNet(u.netResult)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className="admin-users-mobile"
            style={{ display: "none", gridGap: "0.75rem" }}
          >
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                className="card"
                onClick={() => openUser(u.id)}
                style={{
                  padding: "0.85rem",
                  textAlign: "left",
                  width: "100%",
                  cursor: "pointer",
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  color: "inherit",
                }}
              >
                <strong>
                  {maskPhone(u.phone, phoneRevealed.has(u.id))}
                  {u.displayName ? ` · ${u.displayName}` : ""}
                </strong>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  Last {new Date(u.lastSeenAt).toLocaleString()} · {u.totalSlips}{" "}
                  slips · {u.won}W/{u.lost}L/{u.voided}V/{u.submitted}P · net{" "}
                  {fmtNet(u.netResult)}
                </div>
              </button>
            ))}
          </div>

          <style>{`
            @media (max-width: 767px) {
              .admin-users-desktop { display: none !important; }
              .admin-users-mobile { display: grid !important; }
            }
          `}</style>

          {!users.length && !loading && (
            <p className="page-sub">No users match these filters.</p>
          )}
        </>
      ) : (
        <div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginBottom: "0.75rem" }}
            onClick={closeDetail}
          >
            ← Directory
          </button>

          <div
            className="card"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              alignItems: "flex-end",
              padding: "0.75rem",
              marginBottom: "1rem",
            }}
          >
            <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
              Status
              <select
                className="select"
                value={detailStatus}
                onChange={(e) => setDetailStatus(e.target.value)}
                style={{ display: "block", marginTop: 2 }}
              >
                <option value="">All</option>
                <option value="SUBMITTED">SUBMITTED</option>
                <option value="WON">WON</option>
                <option value="LOST">LOST</option>
                <option value="VOID">VOID</option>
              </select>
            </label>
            <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
              From
              <input
                className="input"
                type="date"
                value={detailFrom}
                onChange={(e) => setDetailFrom(e.target.value)}
                style={{ display: "block", marginTop: 2 }}
              />
            </label>
            <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
              To
              <input
                className="input"
                type="date"
                value={detailTo}
                onChange={(e) => setDetailTo(e.target.value)}
                style={{ display: "block", marginTop: 2 }}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={detailLoading}
              onClick={() => selectedId != null && void loadDetail(selectedId)}
            >
              {detailLoading ? "Loading…" : "Filter slips"}
            </button>
          </div>

          {detailError && (
            <div className="alert alert-error" style={{ marginBottom: "0.75rem" }}>
              {detailError}
            </div>
          )}

          {detail && (
            <>
              <div className="card" style={{ padding: "0.85rem", marginBottom: "1rem" }}>
                <h2 style={{ fontSize: "1.1rem", margin: 0 }}>
                  {detail.user.phone}
                  {detail.user.displayName
                    ? ` (${detail.user.displayName})`
                    : ""}
                </h2>
                <p className="page-sub" style={{ margin: "0.35rem 0 0" }}>
                  First {new Date(detail.user.firstSeenAt).toLocaleString()} · Last{" "}
                  {new Date(detail.user.lastSeenAt).toLocaleString()}
                </p>
                <p style={{ fontSize: "0.85rem", margin: "0.5rem 0 0" }}>
                  {detail.stats.totalSlips} slips · {detail.stats.won}W /{" "}
                  {detail.stats.lost}L / {detail.stats.voided}V /{" "}
                  {detail.stats.submitted} pending · win rate{" "}
                  {detail.stats.winRate != null
                    ? `${(detail.stats.winRate * 100).toFixed(0)}%`
                    : "—"}{" "}
                  · avg stake {detail.stats.avgStake.toFixed(2)} · net{" "}
                  {fmtNet(detail.stats.netResult)}
                </p>
                {(detail.stats.topLeagues.length > 0 ||
                  detail.stats.topMarkets.length > 0) && (
                  <p
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--muted)",
                      margin: "0.4rem 0 0",
                    }}
                  >
                    {detail.stats.topLeagues.length > 0 && (
                      <>
                        Leagues:{" "}
                        {detail.stats.topLeagues
                          .map((x) => `${x.label} (${x.count})`)
                          .join(", ")}
                      </>
                    )}
                    {detail.stats.topLeagues.length > 0 &&
                      detail.stats.topMarkets.length > 0 &&
                      " · "}
                    {detail.stats.topMarkets.length > 0 && (
                      <>
                        Markets:{" "}
                        {detail.stats.topMarkets
                          .map((x) => `${x.label} (${x.count})`)
                          .join(", ")}
                      </>
                    )}
                  </p>
                )}
              </div>

              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
                Bet history
              </h3>
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {detail.slips.map((s) => {
                  const open = expandedSlips.has(s.id);
                  return (
                    <div key={s.id} className="card" style={{ padding: "0.85rem" }}>
                      <button
                        type="button"
                        onClick={() => toggleSlip(s.id)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "0.5rem",
                          flexWrap: "wrap",
                          width: "100%",
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          color: "inherit",
                          textAlign: "left",
                        }}
                      >
                        <div>
                          <strong>
                            #{s.id} · {s.status}
                          </strong>
                          <div
                            style={{ fontSize: "0.75rem", color: "var(--muted)" }}
                          >
                            {new Date(s.createdAt).toLocaleString()} · {s.slipType}
                          </div>
                        </div>
                        <div style={{ fontSize: "0.8rem", textAlign: "right" }}>
                          Stake {s.stake.toFixed(2)} · Odd {s.totalOdd.toFixed(2)} ·
                          Return {s.potentialReturn.toFixed(2)}
                          <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                            {open ? "Hide selections" : "Show selections"}
                          </div>
                        </div>
                      </button>
                      {open && (
                        <ul
                          style={{
                            margin: "0.5rem 0 0",
                            paddingLeft: "1.1rem",
                            fontSize: "0.8rem",
                          }}
                        >
                          {s.selections.map((sel) => (
                            <li key={sel.id}>
                              {sel.eventLabel} · {sel.marketLabel} ·{" "}
                              {sel.chosenLabel} @ {sel.chosenOdd.toFixed(2)} ·{" "}
                              {sel.result}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
                {!detail.slips.length && !detailLoading && (
                  <p className="page-sub">No slips match these filters.</p>
                )}
              </div>
            </>
          )}
          {detailLoading && !detail && (
            <p className="page-sub">Loading history…</p>
          )}
        </div>
      )}
    </div>
  );
}
