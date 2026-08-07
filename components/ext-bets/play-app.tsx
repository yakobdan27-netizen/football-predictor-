"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PHONE_STORAGE_NOTICE,
  QUICK_MARKET_DEFS,
  TRACKING_BANNER,
} from "@/lib/bets/constants";
import type { BetFeedLeagueGroup } from "@/lib/bets/feed";
import { LIVE_SYNC_LEAGUES, type LiveSyncLeague } from "@/lib/live/constants";
import {
  MatchMarketView,
  type MarketDto,
} from "@/components/bets/match-market-view";

const SESSION_KEY = "ext_bets_session";

type Tab = "live" | "pre" | "mine";
type SlipMode = "SINGLE" | "MULTI";

type Session = { userId: number; phone: string; displayName?: string | null };

type FeedEvent = {
  betEventId: number;
  apiFixtureId: number;
  leagueId: number;
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
  marketId: number;
  marketType: string;
  chosenLabel: string;
  chosenOdd: number;
  needsOdd?: boolean;
  home: string;
  away: string;
  stake: number;
};

type MySlip = {
  id: number;
  slipType: string;
  stake: number;
  totalOdd: number;
  potentialReturn: number;
  status: string;
  createdAt: string;
  selections: Array<{
    eventLabel: string;
    marketLabel: string;
    chosenLabel: string;
    chosenOdd: number;
    result: string;
  }>;
};

function fmtOdd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.userId || !s.phone) return null;
    return s;
  } catch {
    return null;
  }
}

export function PlayApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("pre");
  const [groups, setGroups] = useState<BetFeedLeagueGroup[]>([]);
  const [league, setLeague] = useState<LiveSyncLeague>("Premier League");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<SlipPick[]>([]);
  const [mode, setMode] = useState<SlipMode>("MULTI");
  const [multiStake, setMultiStake] = useState(10);
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [mySlips, setMySlips] = useState<MySlip[]>([]);
  const [marketEvent, setMarketEvent] = useState<FeedEvent | null>(null);
  const [slipOpen, setSlipOpen] = useState(false);

  useEffect(() => {
    setSession(loadSession());
    setReady(true);
  }, []);

  async function enter() {
    setGateError(null);
    try {
      const res = await fetch("/api/ext/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, displayName }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        userId?: number;
        phone?: string;
        displayName?: string | null;
      };
      if (!res.ok || !data.ok || !data.userId || !data.phone) {
        setGateError(data.error ?? "Could not start session");
        return;
      }
      const s: Session = {
        userId: data.userId,
        phone: data.phone,
        displayName: data.displayName,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      setSession(s);
    } catch (e) {
      setGateError(e instanceof Error ? e.message : "Session failed");
    }
  }

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

  const loadGames = useCallback(async () => {
    if (tab !== "pre" && tab !== "live") return;
    setLoading(true);
    try {
      const res = await fetch("/api/bets/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league, tab }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        groups?: BetFeedLeagueGroup[];
      };
      if (!res.ok || !data.ok) setError(data.error ?? "Load failed");
      else setGroups(data.groups ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [league, tab]);

  const loadMine = useCallback(async (userId: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ext/slips?userId=${userId}`);
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        slips?: MySlip[];
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not load slips");
        setMySlips([]);
      } else {
        setMySlips(data.slips ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load slips");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    if (tab === "pre" || tab === "live") void loadFeed(tab);
    else void loadMine(session.userId);
  }, [session, tab, loadFeed, loadMine]);

  const multiTotalOdd = useMemo(
    () =>
      picks.reduce((acc, p) => acc * (p.chosenOdd > 1 ? p.chosenOdd : 1), 1),
    [picks]
  );
  const multiReturn = useMemo(
    () => Math.round(multiStake * multiTotalOdd * 100) / 100,
    [multiStake, multiTotalOdd]
  );
  const selectedKeys = useMemo(() => new Set(picks.map((p) => p.key)), [picks]);

  function togglePick(ev: FeedEvent, m: MarketDto) {
    const odd =
      m.odd != null && Number.isFinite(m.odd) && m.odd > 1 ? m.odd : NaN;
    const key = `${ev.betEventId}-${m.id}`;
    setPicks((prev) => {
      if (prev.some((p) => p.key === key)) {
        return prev.filter((p) => p.key !== key);
      }
      const needsOdd = !Number.isFinite(odd);
      setSlipOpen(true);
      return [
        ...prev,
        {
          key,
          betEventId: ev.betEventId,
          marketId: m.id,
          marketType: m.marketType,
          chosenLabel: m.selectionLabel,
          chosenOdd: needsOdd ? 1 : odd,
          needsOdd,
          home: ev.home,
          away: ev.away,
          stake: 10,
        },
      ];
    });
  }

  async function submitSlip() {
    if (!session || !picks.length) return;
    setPlacing(true);
    setMsg(null);
    setConfirm(null);
    try {
      const body =
        mode === "SINGLE"
          ? {
              userId: session.userId,
              slipType: "SINGLE" as const,
              selections: picks.map((p) => ({
                betEventId: p.betEventId,
                marketId: p.marketId,
                chosenLabel: p.chosenLabel,
                chosenOdd: p.chosenOdd >= 1 ? p.chosenOdd : 1,
                stake: p.stake,
                eventLabel: `${p.home} vs ${p.away}`,
                marketLabel: `${p.marketType} ${p.chosenLabel}`,
              })),
            }
          : {
              userId: session.userId,
              slipType: "MULTI" as const,
              stake: multiStake,
              selections: picks.map((p) => ({
                betEventId: p.betEventId,
                marketId: p.marketId,
                chosenLabel: p.chosenLabel,
                chosenOdd: p.chosenOdd >= 1 ? p.chosenOdd : 1,
                eventLabel: `${p.home} vs ${p.away}`,
                marketLabel: `${p.marketType} ${p.chosenLabel}`,
              })),
            };
      const res = await fetch("/api/ext/slips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        count?: number;
        slips?: Array<{ id: number; potentialReturn: number }>;
      };
      if (!res.ok || !data.ok) {
        setMsg(data.error ?? "Submit failed");
      } else {
        setConfirm(
          `Recorded for ${session.phone} — ${data.count ?? 1} slip(s). Tracking only, not a payout guarantee.`
        );
        setPicks([]);
        setTab("mine");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setPlacing(false);
    }
  }

  if (!ready) return <p className="page-sub">Loading…</p>;

  if (!session) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: "1rem auto" }}>
        <h1 className="page-title" style={{ fontSize: "1.25rem" }}>
          Play Coupon
        </h1>
        <p className="page-sub">{PHONE_STORAGE_NOTICE}</p>
        <label style={{ display: "block", fontWeight: 600, fontSize: "0.8125rem" }}>
          Phone or access code
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+251… or CODE"
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <label
          style={{
            display: "block",
            fontWeight: 600,
            fontSize: "0.8125rem",
            marginTop: "0.75rem",
          }}
        >
          Display name (optional)
          <input
            className="input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        {gateError && (
          <div className="alert alert-error" style={{ marginTop: "0.75rem" }}>
            {gateError}
          </div>
        )}
        <button
          type="button"
          className="btn"
          style={{ marginTop: "1rem", width: "100%" }}
          onClick={() => void enter()}
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: picks.length ? "calc(12rem + var(--nav-height))" : "4rem" }}>
      <div className="alert ladder-honesty-banner" role="status">
        <strong>Honesty:</strong> {TRACKING_BANNER}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.5rem",
          flexWrap: "wrap",
          margin: "0.75rem 0",
        }}
      >
        <div>
          <h1 className="page-title" style={{ fontSize: "1.25rem", margin: 0 }}>
            Play Coupon
          </h1>
          <p className="page-sub" style={{ margin: 0 }}>
            Signed in as {session.phone}
            {session.displayName ? ` · ${session.displayName}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: "0.75rem" }}
          onClick={() => {
            localStorage.removeItem(SESSION_KEY);
            setSession(null);
          }}
        >
          Switch user
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.35rem",
          marginBottom: "0.75rem",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
        }}
        className="chip-scroll"
      >
        {(
          [
            ["live", "Live"],
            ["pre", "Pre-Match"],
            ["mine", "My slips"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="btn"
            onClick={() => setTab(id)}
            style={{
              fontSize: "0.8125rem",
              flex: "1 1 0",
              minWidth: "5.5rem",
              minHeight: "2.75rem",
              background: tab === id ? "var(--accent)" : "var(--surface2)",
              color: tab === id ? "#fff" : "inherit",
              border: "none",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === "pre" || tab === "live") && (
        <div
          className="card"
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            alignItems: "flex-end",
            marginBottom: "0.75rem",
            padding: "0.75rem",
          }}
        >
          <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
            League
            <select
              className="select"
              value={league}
              onChange={(e) => setLeague(e.target.value as LiveSyncLeague)}
              style={{ display: "block", marginTop: 4 }}
            >
              {LIVE_SYNC_LEAGUES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={() => void loadGames()}
          >
            {loading ? "Loading…" : "Load games"}
          </button>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginBottom: "0.75rem" }}>
          {error}
        </div>
      )}
      {msg && <div className="alert" style={{ marginBottom: "0.75rem" }}>{msg}</div>}
      {confirm && (
        <div className="alert" style={{ marginBottom: "0.75rem" }} role="status">
          {confirm}
        </div>
      )}

      {(tab === "pre" || tab === "live") &&
        groups.map((g) => (
          <section key={g.leagueId} style={{ marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "0.9rem", margin: "0 0 0.35rem" }}>
              {g.leagueName ?? `League ${g.leagueId}`}
            </h2>
            {g.events.map((ev) => {
              const fe = ev as unknown as FeedEvent;
              const quick = QUICK_MARKET_DEFS.map((def) =>
                fe.markets.find(
                  (m) =>
                    m.marketType === def.marketType &&
                    m.selectionLabel === def.selectionLabel
                )
              ).filter(Boolean) as MarketDto[];
              return (
                <div
                  key={fe.betEventId}
                  className="card"
                  style={{ padding: "0.65rem", marginBottom: "0.5rem" }}
                >
                  <div
                    style={{
                      cursor: "pointer",
                      marginBottom: "0.5rem",
                      minHeight: "2.75rem",
                      touchAction: "manipulation",
                    }}
                    onClick={() => setMarketEvent(fe)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setMarketEvent(fe);
                    }}
                  >
                    <strong>
                      {fe.home} vs {fe.away}
                    </strong>
                    <div style={{ fontSize: "0.75rem", color: "var(--accent)", fontWeight: 600 }}>
                      Tap for all markets →
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {quick.map((m) => {
                      const selected = selectedKeys.has(`${fe.betEventId}-${m.id}`);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => togglePick(fe, m)}
                          style={{
                            minWidth: "3.75rem",
                            minHeight: "2.75rem",
                            padding: "0.5rem 0.55rem",
                            borderRadius: 8,
                            border: selected
                              ? "2px solid var(--accent)"
                              : "1px solid var(--border)",
                            background: selected ? "var(--accent)" : "var(--surface2)",
                            color: selected ? "#fff" : "inherit",
                            fontSize: "0.8125rem",
                            fontWeight: 600,
                            touchAction: "manipulation",
                          }}
                        >
                          <div>
                            {QUICK_MARKET_DEFS.find(
                              (d) =>
                                d.marketType === m.marketType &&
                                d.selectionLabel === m.selectionLabel
                            )?.display ?? m.selectionLabel}
                          </div>
                          <div>{fmtOdd(m.odd)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        ))}

      {tab === "mine" && (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          {!mySlips.length && !loading && (
            <p className="page-sub">No slips yet for {session.phone}.</p>
          )}
          {mySlips.map((s) => (
            <div key={s.id} className="card" style={{ padding: "0.75rem" }}>
              <div style={{ fontWeight: 700 }}>
                #{s.id} · {s.slipType} · {s.status}
              </div>
              <div style={{ fontSize: "0.8rem" }}>
                Stake {s.stake} · Odd {fmtOdd(s.totalOdd)} · Return{" "}
                {fmtOdd(s.potentialReturn)}
              </div>
              <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem", fontSize: "0.75rem" }}>
                {s.selections.map((sel, i) => (
                  <li key={i}>
                    {sel.eventLabel} · {sel.marketLabel} @ {fmtOdd(sel.chosenOdd)} ·{" "}
                    {sel.result}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {picks.length > 0 && (
        <div
          className="sticky-above-nav"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 45,
            background: "var(--surface)",
            borderTop: "1px solid var(--border)",
            padding: "0.75rem",
            maxHeight: slipOpen ? "70dvh" : "4.5rem",
            overflow: "auto",
            boxShadow: "0 -8px 24px rgba(0,0,0,0.2)",
          }}
        >
          <button
            type="button"
            onClick={() => setSlipOpen((o) => !o)}
            style={{
              width: "100%",
              minHeight: "2.75rem",
              fontWeight: 700,
              background: "none",
              border: "none",
              color: "inherit",
              textAlign: "left",
              marginBottom: "0.35rem",
              touchAction: "manipulation",
            }}
          >
            {slipOpen ? "▾" : "▴"} Slip ({picks.length})
          </button>
          {slipOpen && (
            <>
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
                    {m}
                  </button>
                ))}
              </div>
              {picks.map((p) => (
                <div
                  key={p.key}
                  style={{
                    fontSize: "0.75rem",
                    marginBottom: "0.35rem",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.35rem",
                  }}
                >
                  <span>
                    {p.home} vs {p.away} · {p.chosenLabel} @{" "}
                    <input
                      type="number"
                      step="0.01"
                      min="1.01"
                      value={p.chosenOdd}
                      onChange={(e) => {
                        const odd = parseFloat(e.target.value);
                        setPicks((prev) =>
                          prev.map((x) =>
                            x.key === p.key
                              ? {
                                  ...x,
                                  chosenOdd: Number.isFinite(odd) ? odd : 1,
                                  needsOdd: !(Number.isFinite(odd) && odd > 1),
                                }
                              : x
                          )
                        );
                      }}
                      style={{ width: "3.5rem" }}
                    />
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPicks((prev) => prev.filter((x) => x.key !== p.key))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {mode === "MULTI" && (
                <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                  Stake
                  <input
                    className="input"
                    type="number"
                    min={0.01}
                    step={1}
                    value={multiStake}
                    onChange={(e) => setMultiStake(parseFloat(e.target.value) || 0)}
                    style={{ display: "block", width: "8rem", marginTop: 2 }}
                  />
                </label>
              )}
              <div style={{ fontSize: "0.8rem", margin: "0.5rem 0" }}>
                Total odd {fmtOdd(multiTotalOdd)} · Return {fmtOdd(multiReturn)}
              </div>
              <button
                type="button"
                className="btn"
                style={{ width: "100%" }}
                disabled={placing}
                onClick={() => void submitSlip()}
              >
                {placing ? "Submitting…" : "Submit Slip"}
              </button>
            </>
          )}
        </div>
      )}

      {marketEvent && (
        <MatchMarketView
          event={marketEvent}
          selectedKeys={selectedKeys}
          onClose={() => setMarketEvent(null)}
          onToggle={(m) => togglePick(marketEvent, m)}
          onSaveOdd={async (marketId, odd) => {
            await fetch(`/api/bets/markets/${marketId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ odd }),
            });
            if (tab === "pre" || tab === "live") void loadFeed(tab);
          }}
        />
      )}
    </div>
  );
}
