"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { TRACKING_BANNER, QUICK_MARKET_DEFS } from "@/lib/bets/constants";
import type { BetFeedLeagueGroup } from "@/lib/bets/feed";

type Tab = "live" | "pre" | "open" | "settled";
type SlipMode = "SINGLE" | "MULTI";

type MarketDto = {
  id: number;
  betEventId: number;
  marketType: string;
  selectionLabel: string;
  odd: number | null;
  source: string;
};

type FeedEvent = {
  betEventId: number;
  apiFixtureId: number;
  leagueId: number;
  leagueName: string | null;
  home: string;
  away: string;
  kickoffUtc: string;
  status: string;
  minute: number | null;
  homeScore: number | null;
  awayScore: number | null;
  markets: MarketDto[];
};

type SlipPick = {
  key: string;
  betEventId: number;
  apiFixtureId: number;
  marketId: number;
  marketType: string;
  chosenLabel: string;
  chosenOdd: number;
  home: string;
  away: string;
  stake: number;
};

type OpenSlip = {
  id: number;
  slipType: string;
  stake: number;
  totalOdd: number;
  potentialReturn: number;
  status: string;
  settledAt: string | null;
  note: string | null;
  selections: Array<{
    id: number;
    chosenLabel: string;
    chosenOdd: number;
    result: string;
    provisional?: string;
    liveScore?: {
      home: number | null;
      away: number | null;
      status: string;
      minute: number | null;
    } | null;
    event: {
      home: string;
      away: string;
      apiFixtureId: number;
    } | null;
    market: { marketType: string } | null;
  }>;
};

function fmtOdd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function kickoffLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function quickMarkets(markets: MarketDto[]): MarketDto[] {
  const out: MarketDto[] = [];
  for (const def of QUICK_MARKET_DEFS) {
    const hit = markets.find(
      (m) =>
        m.marketType === def.marketType &&
        m.selectionLabel === def.selectionLabel
    );
    if (hit) out.push(hit);
  }
  return out;
}

function displayLabel(m: MarketDto): string {
  const def = QUICK_MARKET_DEFS.find(
    (d) =>
      d.marketType === m.marketType && d.selectionLabel === m.selectionLabel
  );
  return def?.display ?? m.selectionLabel;
}

export function BetCouponApp() {
  const [tab, setTab] = useState<Tab>("pre");
  const [groups, setGroups] = useState<BetFeedLeagueGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<string>("");
  const [picks, setPicks] = useState<SlipPick[]>([]);
  const [mode, setMode] = useState<SlipMode>("SINGLE");
  const [multiStake, setMultiStake] = useState(10);
  const [slipOpen, setSlipOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeMsg, setPlaceMsg] = useState<string | null>(null);
  const [slips, setSlips] = useState<OpenSlip[]>([]);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [editingOdd, setEditingOdd] = useState<Record<number, string>>({});

  const loadQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/bets/status");
      const data = (await res.json()) as {
        remaining?: number | null;
        limitDay?: number | null;
        current?: number | null;
        error?: string;
      };
      if (data.remaining != null && data.limitDay != null) {
        setQuota(`AF ${data.remaining}/${data.limitDay} left`);
      } else if (data.error) {
        setQuota(data.error.slice(0, 40));
      } else {
        setQuota("AF status n/a");
      }
    } catch {
      setQuota("AF status n/a");
    }
  }, []);

  const loadFeed = useCallback(async (t: Tab) => {
    if (t !== "pre" && t !== "live") return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/feed?tab=${t}`);
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        groups?: BetFeedLeagueGroup[];
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Feed failed");
        setGroups([]);
      } else {
        setGroups(data.groups ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Feed failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSlips = useCallback(async (status: "OPEN" | "SETTLED") => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bets/slips?status=${status}`);
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        slips?: OpenSlip[];
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Slips failed");
        setSlips([]);
      } else {
        setSlips(data.slips ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Slips failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  useEffect(() => {
    if (tab === "pre" || tab === "live") void loadFeed(tab);
    else void loadSlips(tab === "open" ? "OPEN" : "SETTLED");
  }, [tab, loadFeed, loadSlips]);

  // 60s DB poll for open bets + live feed scores
  useEffect(() => {
    if (tab !== "open" && tab !== "live") return;
    const id = setInterval(() => {
      if (tab === "open") void loadSlips("OPEN");
      if (tab === "live") void loadFeed("live");
    }, 60_000);
    return () => clearInterval(id);
  }, [tab, loadFeed, loadSlips]);

  const hasSameEventConflict = useMemo(() => {
    if (mode !== "MULTI") return false;
    const ids = picks.map((p) => p.betEventId);
    return new Set(ids).size < ids.length;
  }, [mode, picks]);

  const multiTotalOdd = useMemo(
    () => picks.reduce((acc, p) => acc * p.chosenOdd, picks.length ? 1 : 0),
    [picks]
  );
  const multiReturn = useMemo(
    () => Math.round(multiStake * multiTotalOdd * 100) / 100,
    [multiStake, multiTotalOdd]
  );

  function togglePick(ev: FeedEvent, m: MarketDto) {
    const odd =
      m.odd ??
      (editingOdd[m.id] ? parseFloat(editingOdd[m.id]!) : NaN);
    const key = `${ev.betEventId}-${m.id}`;
    setPicks((prev) => {
      if (prev.some((p) => p.key === key)) {
        return prev.filter((p) => p.key !== key);
      }
      if (!Number.isFinite(odd) || odd <= 1) {
        setPlaceMsg("Enter an odd > 1 for MANUAL markets before adding.");
        return prev;
      }
      setSlipOpen(true);
      setPlaceMsg(null);
      return [
        ...prev,
        {
          key,
          betEventId: ev.betEventId,
          apiFixtureId: ev.apiFixtureId,
          marketId: m.id,
          marketType: m.marketType,
          chosenLabel: m.selectionLabel,
          chosenOdd: odd,
          home: ev.home,
          away: ev.away,
          stake: 10,
        },
      ];
    });
  }

  async function saveManualOdd(marketId: number) {
    const raw = editingOdd[marketId];
    const odd = raw == null || raw === "" ? null : parseFloat(raw);
    if (odd != null && (!Number.isFinite(odd) || odd <= 1)) {
      setPlaceMsg("Odd must be > 1");
      return;
    }
    const res = await fetch(`/api/bets/markets/${marketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ odd }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      setPlaceMsg(data.error ?? "Failed to save odd");
      return;
    }
    if (tab === "pre" || tab === "live") void loadFeed(tab);
  }

  async function refreshOdds(fixtureId: number) {
    setPlaceMsg("Refreshing odds…");
    const res = await fetch("/api/bets/odds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fixtureId }),
    });
    const data = (await res.json()) as { ok?: boolean; warning?: string; error?: string };
    setPlaceMsg(data.warning ?? data.error ?? (data.ok ? "Odds updated" : "Odds refresh failed"));
    if (tab === "pre" || tab === "live") void loadFeed(tab);
  }

  async function placeSlip() {
    if (!picks.length) return;
    setPlacing(true);
    setPlaceMsg(null);
    try {
      const body =
        mode === "SINGLE"
          ? {
              slipType: "SINGLE" as const,
              selections: picks.map((p) => ({
                betEventId: p.betEventId,
                marketId: p.marketId,
                chosenLabel: p.chosenLabel,
                chosenOdd: p.chosenOdd,
                stake: p.stake,
              })),
            }
          : {
              slipType: "MULTI" as const,
              stake: multiStake,
              selections: picks.map((p) => ({
                betEventId: p.betEventId,
                marketId: p.marketId,
                chosenLabel: p.chosenLabel,
                chosenOdd: p.chosenOdd,
              })),
            };
      const res = await fetch("/api/bets/slips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        count?: number;
      };
      if (!res.ok || !data.ok) {
        setPlaceMsg(data.error ?? "Place failed");
      } else {
        setPlaceMsg(`Placed ${data.count ?? 1} slip(s)`);
        setPicks([]);
        setTab("open");
      }
    } catch (e) {
      setPlaceMsg(e instanceof Error ? e.message : "Place failed");
    } finally {
      setPlacing(false);
    }
  }

  async function runSettle() {
    const res = await fetch("/api/bets/settle", { method: "POST" });
    const data = (await res.json()) as {
      ok?: boolean;
      settledSlips?: number;
      error?: string;
    };
    setPlaceMsg(
      data.ok
        ? `Settled ${data.settledSlips ?? 0} slip(s)`
        : data.error ?? "Settle failed"
    );
    if (tab === "open" || tab === "settled") {
      void loadSlips(tab === "open" ? "OPEN" : "SETTLED");
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "live", label: "Live" },
    { id: "pre", label: "Pre-Match" },
    { id: "open", label: "Open Bets" },
    { id: "settled", label: "Settled" },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: "1rem",
        paddingBottom: picks.length ? "14rem" : "5rem",
      }}
      className="bets-layout"
    >
      <style>{`
        @media (min-width: 960px) {
          .bets-layout { grid-template-columns: minmax(0, 1fr) 20rem !important; padding-bottom: 2rem !important; }
          .bets-slip-mobile { display: none !important; }
          .bets-slip-desktop { display: block !important; }
        }
        @media (max-width: 959px) {
          .bets-slip-desktop { display: none !important; }
        }
        @keyframes bets-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
      `}</style>

      <div>
        <div
          className="alert"
          style={{
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            fontSize: "0.8125rem",
            marginBottom: "0.75rem",
          }}
        >
          {TRACKING_BANNER}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "0.5rem",
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: "0.75rem",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Bets</h1>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              {quota}
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: "0.75rem" }}
              onClick={() => void runSettle()}
            >
              Settle FT
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "0.35rem",
            flexWrap: "wrap",
            marginBottom: "0.75rem",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn"
              onClick={() => setTab(t.id)}
              style={{
                fontSize: "0.8125rem",
                background:
                  tab === t.id ? "var(--accent)" : "var(--surface2)",
                color: tab === t.id ? "#fff" : "inherit",
                border: "none",
              }}
            >
              {t.label}
              {t.id === "open" && picks.length
                ? ""
                : t.id === "live" || t.id === "pre"
                  ? ""
                  : ""}
            </button>
          ))}
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: "0.75rem" }}>
            {error}
          </div>
        )}
        {placeMsg && (
          <p style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
            {placeMsg}
          </p>
        )}
        {loading && (
          <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>Loading…</p>
        )}

        {(tab === "pre" || tab === "live") &&
          groups.map((g) => {
            const leagueGroups = g as unknown as BetFeedLeagueGroup & {
              events: FeedEvent[];
            };
            const isCollapsed = collapsed[g.leagueId];
            return (
              <section key={g.leagueId} style={{ marginBottom: "1rem" }}>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((c) => ({
                      ...c,
                      [g.leagueId]: !c[g.leagueId],
                    }))
                  }
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    padding: "0.5rem 0",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {isCollapsed ? "▸" : "▾"} {g.leagueName} (
                  {leagueGroups.events?.length ?? 0})
                </button>
                {!isCollapsed &&
                  (leagueGroups.events ?? []).map((ev) => (
                    <EventCard
                      key={ev.apiFixtureId}
                      ev={ev}
                      live={tab === "live"}
                      picks={picks}
                      editingOdd={editingOdd}
                      setEditingOdd={setEditingOdd}
                      onToggle={togglePick}
                      onSaveOdd={saveManualOdd}
                      onRefreshOdds={refreshOdds}
                    />
                  ))}
              </section>
            );
          })}

        {(tab === "open" || tab === "settled") && (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {!slips.length && !loading && (
              <p style={{ color: "var(--muted)" }}>No slips.</p>
            )}
            {slips.map((slip) => (
              <SlipCard key={slip.id} slip={slip} showProvisional={tab === "open"} />
            ))}
          </div>
        )}
      </div>

      {/* Desktop slip */}
      <aside className="bets-slip-desktop">
        <SlipPanel
          picks={picks}
          mode={mode}
          setMode={setMode}
          multiStake={multiStake}
          setMultiStake={setMultiStake}
          multiTotalOdd={multiTotalOdd}
          multiReturn={multiReturn}
          hasConflict={hasSameEventConflict}
          placing={placing}
          onPlace={placeSlip}
          onRemove={(key) => setPicks((p) => p.filter((x) => x.key !== key))}
          onStake={(key, stake) =>
            setPicks((p) =>
              p.map((x) => (x.key === key ? { ...x, stake } : x))
            )
          }
        />
      </aside>

      {/* Mobile sticky slip */}
      <div
        className="bets-slip-mobile"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60,
          background: "var(--surface)",
          borderTop: "1px solid var(--border)",
          boxShadow: "0 -8px 24px rgba(0,0,0,0.2)",
          maxHeight: slipOpen ? "70dvh" : "3.5rem",
          overflow: "auto",
          transition: "max-height 0.2s ease",
        }}
      >
        <button
          type="button"
          onClick={() => setSlipOpen((o) => !o)}
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            padding: "0.85rem 1rem",
            background: "transparent",
            border: "none",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <span>
            Bet slip{" "}
            <span
              style={{
                background: "var(--accent)",
                color: "#fff",
                borderRadius: "999px",
                padding: "0.1rem 0.45rem",
                fontSize: "0.75rem",
              }}
            >
              {picks.length}
            </span>
          </span>
          <span>{slipOpen ? "▾" : "▴"}</span>
        </button>
        {slipOpen && (
          <div style={{ padding: "0 1rem 1rem" }}>
            <SlipPanel
              picks={picks}
              mode={mode}
              setMode={setMode}
              multiStake={multiStake}
              setMultiStake={setMultiStake}
              multiTotalOdd={multiTotalOdd}
              multiReturn={multiReturn}
              hasConflict={hasSameEventConflict}
              placing={placing}
              onPlace={placeSlip}
              onRemove={(key) => setPicks((p) => p.filter((x) => x.key !== key))}
              onStake={(key, stake) =>
                setPicks((p) =>
                  p.map((x) => (x.key === key ? { ...x, stake } : x))
                )
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function EventCard({
  ev,
  live,
  picks,
  editingOdd,
  setEditingOdd,
  onToggle,
  onSaveOdd,
  onRefreshOdds,
}: {
  ev: FeedEvent;
  live: boolean;
  picks: SlipPick[];
  editingOdd: Record<number, string>;
  setEditingOdd: Dispatch<SetStateAction<Record<number, string>>>;
  onToggle: (ev: FeedEvent, m: MarketDto) => void;
  onSaveOdd: (id: number) => void;
  onRefreshOdds: (fixtureId: number) => void;
}) {
  const markets = quickMarkets(ev.markets);
  return (
    <div
      className="card"
      style={{
        padding: "0.75rem",
        marginTop: "0.5rem",
        border: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.5rem",
          marginBottom: "0.35rem",
        }}
      >
        <div>
          {live && (
            <span
              style={{
                color: "var(--danger, #c44)",
                fontWeight: 700,
                fontSize: "0.7rem",
                marginRight: "0.4rem",
                animation: "bets-pulse 1.2s infinite",
              }}
            >
              LIVE {ev.minute != null ? `${ev.minute}'` : ""}
            </span>
          )}
          <strong>
            {ev.home}{" "}
            {live
              ? `${ev.homeScore ?? 0}–${ev.awayScore ?? 0}`
              : "vs"}{" "}
            {ev.away}
          </strong>
          {!live && (
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              {kickoffLocal(ev.kickoffUtc)}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: "0.65rem", alignSelf: "start" }}
          onClick={() => onRefreshOdds(ev.apiFixtureId)}
        >
          Odds
        </button>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.35rem",
        }}
      >
        {markets.map((m) => {
          const selected = picks.some(
            (p) => p.betEventId === ev.betEventId && p.marketId === m.id
          );
          const needsManual = m.odd == null || m.source === "MANUAL";
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                type="button"
                onClick={() => onToggle(ev, m)}
                style={{
                  minWidth: "3.5rem",
                  padding: "0.4rem 0.5rem",
                  borderRadius: 6,
                  border: selected
                    ? "2px solid var(--accent)"
                    : "1px solid var(--border)",
                  background: selected ? "var(--accent)" : "var(--surface2)",
                  color: selected ? "#fff" : "inherit",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                }}
              >
                <div>{displayLabel(m)}</div>
                <div style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fmtOdd(m.odd)}
                </div>
              </button>
              {needsManual && (
                <div style={{ display: "flex", gap: 2 }}>
                  <input
                    type="number"
                    step="0.01"
                    min="1.01"
                    placeholder="odd"
                    value={editingOdd[m.id] ?? ""}
                    onChange={(e) =>
                      setEditingOdd((prev) => ({
                        ...prev,
                        [m.id]: e.target.value,
                      }))
                    }
                    style={{
                      width: "3.5rem",
                      fontSize: "0.65rem",
                      padding: "0.15rem",
                    }}
                  />
                  <button
                    type="button"
                    style={{ fontSize: "0.6rem" }}
                    onClick={() => onSaveOdd(m.id)}
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
  );
}

function SlipPanel({
  picks,
  mode,
  setMode,
  multiStake,
  setMultiStake,
  multiTotalOdd,
  multiReturn,
  hasConflict,
  placing,
  onPlace,
  onRemove,
  onStake,
}: {
  picks: SlipPick[];
  mode: SlipMode;
  setMode: (m: SlipMode) => void;
  multiStake: number;
  setMultiStake: (n: number) => void;
  multiTotalOdd: number;
  multiReturn: number;
  hasConflict: boolean;
  placing: boolean;
  onPlace: () => void;
  onRemove: (key: string) => void;
  onStake: (key: string, stake: number) => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: "0.75rem",
        position: "sticky",
        top: "1rem",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Coupon</div>
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.5rem" }}>
        {(["SINGLE", "MULTI"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="btn"
            onClick={() => setMode(m)}
            style={{
              flex: 1,
              fontSize: "0.75rem",
              background: mode === m ? "var(--accent)" : "var(--surface2)",
              color: mode === m ? "#fff" : "inherit",
              border: "none",
            }}
          >
            {m === "SINGLE" ? "Single" : "Multi"}
          </button>
        ))}
      </div>
      {hasConflict && (
        <p
          style={{
            fontSize: "0.75rem",
            color: "var(--warn, #b80)",
            margin: "0 0 0.5rem",
          }}
        >
          Warning: conflicting selections on the same event (still allowed).
        </p>
      )}
      {!picks.length && (
        <p style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>
          Tap odds to add selections.
        </p>
      )}
      {picks.map((p) => (
        <div
          key={p.key}
          style={{
            borderTop: "1px solid var(--border)",
            padding: "0.5rem 0",
            fontSize: "0.8125rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>
              {p.home} vs {p.away}
            </span>
            <button
              type="button"
              onClick={() => onRemove(p.key)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "var(--muted)",
              }}
            >
              ×
            </button>
          </div>
          <div style={{ color: "var(--muted)" }}>
            {p.marketType} · {p.chosenLabel} @ {fmtOdd(p.chosenOdd)}
          </div>
          {mode === "SINGLE" && (
            <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", marginTop: 4 }}>
              Stake
              <input
                type="number"
                min={0}
                step={1}
                value={p.stake}
                onChange={(e) => onStake(p.key, Number(e.target.value) || 0)}
                style={{ width: "5rem" }}
              />
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                → {fmtOdd(p.stake * p.chosenOdd)}
              </span>
            </label>
          )}
        </div>
      ))}
      {mode === "MULTI" && picks.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
          <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
            Stake
            <input
              type="number"
              min={0}
              step={1}
              value={multiStake}
              onChange={(e) => setMultiStake(Number(e.target.value) || 0)}
              style={{ width: "5rem" }}
            />
          </label>
          <div style={{ marginTop: "0.35rem", fontWeight: 600 }}>
            Total odd {fmtOdd(multiTotalOdd)} · Return {fmtOdd(multiReturn)}
          </div>
        </div>
      )}
      <button
        type="button"
        className="btn"
        disabled={!picks.length || placing}
        onClick={onPlace}
        style={{
          width: "100%",
          marginTop: "0.75rem",
          background: "var(--accent)",
          color: "#fff",
          border: "none",
        }}
      >
        {placing ? "Placing…" : "Place Slip"}
      </button>
    </div>
  );
}

function SlipCard({
  slip,
  showProvisional,
}: {
  slip: OpenSlip;
  showProvisional: boolean;
}) {
  const statusColor =
    slip.status === "WON"
      ? "var(--ok, #2a7)"
      : slip.status === "LOST"
        ? "var(--danger, #c44)"
        : "var(--muted)";
  return (
    <div
      className="card"
      style={{ padding: "0.75rem", border: "1px solid var(--border)" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "0.35rem",
        }}
      >
        <strong>
          #{slip.id} · {slip.slipType}
        </strong>
        <span style={{ color: statusColor, fontWeight: 700 }}>
          {slip.status}
        </span>
      </div>
      <div style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
        Stake {fmtOdd(slip.stake)} · Odd {fmtOdd(slip.totalOdd)} · Return{" "}
        {fmtOdd(slip.potentialReturn)}
      </div>
      {slip.note && (
        <div style={{ fontSize: "0.75rem", color: "var(--warn, #b80)" }}>
          {slip.note}
        </div>
      )}
      {slip.selections.map((s) => {
        const pill =
          showProvisional && s.result === "PENDING"
            ? s.provisional
            : s.result.toLowerCase();
        const pillColor =
          pill === "winning" || pill === "won"
            ? "#2a7"
            : pill === "losing" || pill === "lost"
              ? "#c44"
              : "#888";
        return (
          <div
            key={s.id}
            style={{
              borderTop: "1px solid var(--border)",
              marginTop: "0.4rem",
              paddingTop: "0.4rem",
              fontSize: "0.8125rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>
                {s.event?.home} vs {s.event?.away}
              </span>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: pillColor,
                  textTransform: "uppercase",
                }}
              >
                {showProvisional && s.result === "PENDING"
                  ? `Live (${pill})`
                  : s.result}
              </span>
            </div>
            <div style={{ color: "var(--muted)" }}>
              {s.market?.marketType} · {s.chosenLabel} @ {fmtOdd(s.chosenOdd)}
              {s.liveScore
                ? ` · ${s.liveScore.home ?? "—"}–${s.liveScore.away ?? "—"} ${s.liveScore.minute != null ? `${s.liveScore.minute}'` : ""}`
                : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
