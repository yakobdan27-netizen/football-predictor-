"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FULL_MARKET_CATALOG,
  type MarketCategoryId,
} from "@/lib/bets/constants";

export type MarketDto = {
  id: number;
  betEventId: number;
  marketType: string;
  selectionLabel: string;
  odd: number | null;
  source: string;
};

export type MarketViewEvent = {
  betEventId: number;
  apiFixtureId: number;
  home: string;
  away: string;
  kickoffUtc: string;
  status: string;
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
};

type Props = {
  event: MarketViewEvent;
  selectedKeys: Set<string>;
  onClose: () => void;
  onToggle: (market: MarketDto) => void;
  onSaveOdd: (marketId: number, odd: number | null) => Promise<void>;
  /** Override drawer subtitle (default: add to slip). */
  subtitle?: string;
};

const CATS_KEY = "bets_market_cats";

function loadExpanded(): Set<MarketCategoryId> {
  try {
    const raw = localStorage.getItem(CATS_KEY);
    if (!raw) return new Set(["main", "goals"]);
    const arr = JSON.parse(raw) as MarketCategoryId[];
    return new Set(arr);
  } catch {
    return new Set(["main", "goals"]);
  }
}

function fmtOdd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export function MatchMarketView({
  event,
  selectedKeys,
  onClose,
  onToggle,
  onSaveOdd,
  subtitle = "All markets — tap to add to slip",
}: Props) {
  const [markets, setMarkets] = useState<MarketDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<MarketCategoryId>>(loadExpanded);
  const [editingOdd, setEditingOdd] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/bets/events/${event.betEventId}/markets?refresh=1`
        );
        const data = (await res.json()) as {
          ok?: boolean;
          markets?: MarketDto[];
          warning?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setWarning(data.error ?? "Failed to load markets");
          setMarkets([]);
        } else {
          setMarkets(data.markets ?? []);
          setWarning(data.warning ?? null);
        }
      } catch (e) {
        if (!cancelled) {
          setWarning(e instanceof Error ? e.message : "Failed to load markets");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event.betEventId]);

  function toggleCat(id: MarketCategoryId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(CATS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const byKey = useMemo(() => {
    const m = new Map<string, MarketDto>();
    for (const row of markets) {
      m.set(`${row.marketType}::${row.selectionLabel}`, row);
    }
    return m;
  }, [markets]);

  const q = filter.trim().toLowerCase();
  const categories = FULL_MARKET_CATALOG.filter(
    (c) =>
      !q ||
      c.title.toLowerCase().includes(q) ||
      c.markets.some((m) => m.title.toLowerCase().includes(q))
  );

  const live = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(
    event.status.toUpperCase()
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: "min(100%, 28rem)",
          height: "100%",
          maxHeight: "100dvh",
          margin: 0,
          borderRadius: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "0.75rem 1rem",
            borderBottom: "1px solid var(--border)",
            position: "sticky",
            top: 0,
            background: "var(--surface)",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "0.5rem",
              alignItems: "start",
            }}
          >
            <div>
              {live && (
                <span
                  style={{
                    color: "var(--danger, #c44)",
                    fontWeight: 700,
                    fontSize: "0.7rem",
                  }}
                >
                  LIVE {event.minute != null ? `${event.minute}'` : ""}{" "}
                  {event.homeScore ?? 0}–{event.awayScore ?? 0}
                </span>
              )}
              <div style={{ fontWeight: 700 }}>
                {event.home} vs {event.away}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                {subtitle}
              </div>
            </div>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
          <input
            className="input"
            placeholder="Filter markets…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginTop: "0.5rem", width: "100%" }}
          />
          {warning && (
            <p style={{ fontSize: "0.75rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
              {warning}
            </p>
          )}
        </div>

        <div style={{ overflow: "auto", flex: 1, padding: "0.75rem" }}>
          {loading ? (
            <p className="page-sub">Loading markets…</p>
          ) : (
            categories.map((cat) => {
              const open = expanded.has(cat.id) || !!q;
              return (
                <div key={cat.id} style={{ marginBottom: "0.75rem" }}>
                  <button
                    type="button"
                    onClick={() => toggleCat(cat.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      fontWeight: 700,
                      background: "none",
                      border: "none",
                      padding: "0.35rem 0",
                      cursor: "pointer",
                      color: "inherit",
                    }}
                  >
                    {open ? "▾" : "▸"} {cat.title}
                  </button>
                  {open &&
                    cat.markets.map((mkt) => (
                      <div key={mkt.marketType} style={{ marginBottom: "0.65rem" }}>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color: "var(--muted)",
                            marginBottom: "0.25rem",
                          }}
                        >
                          {mkt.title}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.35rem",
                          }}
                        >
                          {mkt.outcomes.map((out) => {
                            const row = byKey.get(
                              `${out.marketType}::${out.selectionLabel}`
                            );
                            if (!row) {
                              return (
                                <span
                                  key={out.selectionLabel}
                                  style={{
                                    fontSize: "0.7rem",
                                    color: "var(--muted)",
                                  }}
                                >
                                  {out.display} FILL FROM DB
                                </span>
                              );
                            }
                            const key = `${event.betEventId}-${row.id}`;
                            const selected = selectedKeys.has(key);
                            const needsManual =
                              row.odd == null || row.source === "MANUAL";
                            return (
                              <div
                                key={row.id}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 2,
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => onToggle(row)}
                                  style={{
                                    minWidth: "3.75rem",
                                    minHeight: "2.75rem",
                                    padding: "0.5rem 0.55rem",
                                    borderRadius: 8,
                                    border: selected
                                      ? "2px solid var(--accent)"
                                      : "1px solid var(--border)",
                                    background: selected
                                      ? "var(--accent)"
                                      : "var(--surface2)",
                                    color: selected ? "#fff" : "inherit",
                                    cursor: "pointer",
                                    fontSize: "0.8125rem",
                                    fontWeight: 600,
                                    touchAction: "manipulation",
                                  }}
                                >
                                  <div>{out.display}</div>
                                  <div style={{ fontVariantNumeric: "tabular-nums" }}>
                                    {fmtOdd(row.odd)}
                                  </div>
                                </button>
                                {needsManual && (
                                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="1.01"
                                      placeholder="—"
                                      value={editingOdd[row.id] ?? ""}
                                      onChange={(e) =>
                                        setEditingOdd((prev) => ({
                                          ...prev,
                                          [row.id]: e.target.value,
                                        }))
                                      }
                                      style={{
                                        width: "4.25rem",
                                        minHeight: "2.5rem",
                                        fontSize: "0.875rem",
                                        padding: "0.35rem 0.4rem",
                                      }}
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      style={{
                                        minHeight: "2.5rem",
                                        fontSize: "0.75rem",
                                        padding: "0.35rem 0.55rem",
                                      }}
                                      onClick={() => {
                                        const raw = editingOdd[row.id];
                                        const odd =
                                          raw == null || raw === ""
                                            ? null
                                            : parseFloat(raw);
                                        void onSaveOdd(row.id, odd);
                                      }}
                                    >
                                      Set
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
