"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MatchMarketView,
  type MarketDto,
  type MarketViewEvent,
} from "@/components/bets/match-market-view";
import { QUICK_MARKET_DEFS } from "@/lib/bets/constants";
import {
  fetchAllUpcomingLeaguesClient,
  NEXT_MATCHES_LEAGUES,
  UPCOMING_API_UNAVAILABLE_COPY,
  type UpcomingLeagueFetchResult,
} from "@/lib/football-api/fetch-upcoming-client";
import type {
  NextMatchesLeague,
  UpcomingFixtureRow,
} from "@/lib/football-api/fetch-upcoming-league";
import {
  applyBetPickToLogMatch,
  betPickDisplayLabel,
  isBetPickMappable,
  type BetMarketPick,
} from "@/lib/prediction-log/bet-market-mapper";
import {
  draftHasApiFixtureId,
  filterUpcomingNext7Days,
  logMatchFromUpcomingFixture,
} from "@/lib/prediction-log/batch-fixture-picker";
import { matchLegLabel } from "@/lib/prediction-log/match-entry-helpers";
import { newId } from "@/lib/prediction-log/storage";
import type { CombinedOddsSettings, LogMatch } from "@/lib/prediction-log/types";

type PickMeta = {
  marketId: number;
  betEventId: number;
  pick: BetMarketPick;
};

interface FixtureBatchPickerProps {
  matches: LogMatch[];
  comboSettings: CombinedOddsSettings;
  onChange: (matches: LogMatch[]) => void;
}

function formatKickoff(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return { date: iso.slice(0, 10), time: "—" };
  }
  return {
    date: d.toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
    time: d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function upsertFixtureLeg(
  matches: LogMatch[],
  fixture: UpcomingFixtureRow,
  updated: LogMatch
): LogMatch[] {
  const idx = matches.findIndex((m) => m.apiFixtureId === fixture.apiFixtureId);
  if (idx >= 0) {
    const next = [...matches];
    next[idx] = updated;
    return next;
  }
  return [...matches, updated];
}

export function FixtureBatchPicker({
  matches,
  comboSettings,
  onChange,
}: FixtureBatchPickerProps) {
  const [activeLeague, setActiveLeague] = useState<NextMatchesLeague>("Premier League");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [leagueResults, setLeagueResults] = useState<UpcomingLeagueFetchResult[]>([]);
  const [drawerFixture, setDrawerFixture] = useState<UpcomingFixtureRow | null>(null);
  const [drawerEvent, setDrawerEvent] = useState<MarketViewEvent | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickMetaByFixture, setPickMetaByFixture] = useState<Record<number, PickMeta>>({});

  const loadFixtures = useCallback(async (refresh = false) => {
    setLoading(true);
    setFetchError(null);
    try {
      const { results } = await fetchAllUpcomingLeaguesClient(refresh, 50);
      setLeagueResults(results);
      const anyError = results.every((r) => r.fixtures.length === 0 && r.error);
      if (anyError) {
        setFetchError(UPCOMING_API_UNAVAILABLE_COPY);
      }
    } catch {
      setFetchError(UPCOMING_API_UNAVAILABLE_COPY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFixtures(false);
  }, [loadFixtures]);

  const allFixtures = useMemo(
    () => leagueResults.flatMap((r) => r.fixtures),
    [leagueResults]
  );
  const nextWeekFixtures = useMemo(
    () => filterUpcomingNext7Days(allFixtures),
    [allFixtures]
  );

  const fixturesByLeague = useMemo(() => {
    const map: Record<string, UpcomingFixtureRow[]> = {};
    for (const league of NEXT_MATCHES_LEAGUES) map[league] = [];
    for (const row of nextWeekFixtures) {
      if (!map[row.league]) map[row.league] = [];
      map[row.league]!.push(row);
    }
    return map;
  }, [nextWeekFixtures]);

  const visibleFixtures = fixturesByLeague[activeLeague] ?? [];

  async function ensureBetEvent(
    fixture: UpcomingFixtureRow,
    refresh = true
  ): Promise<MarketViewEvent | null> {
    const res = await fetch("/api/fixtures/ensure-bet-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiFixtureId: fixture.apiFixtureId,
        leagueId: fixture.leagueId,
        home: fixture.home.name,
        away: fixture.away.name,
        kickoffIso: fixture.kickoffIso,
        status: fixture.status,
        refresh,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      event?: MarketViewEvent;
    };
    if (!res.ok || !data.ok || !data.event) {
      throw new Error(data.error ?? "Could not prepare markets for this fixture");
    }
    return data.event;
  }

  async function openFixtureDrawer(fixture: UpcomingFixtureRow) {
    setPickError(null);
    setOpeningId(fixture.apiFixtureId);
    try {
      const event = await ensureBetEvent(fixture, true);
      setDrawerFixture(fixture);
      setDrawerEvent(event);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : "Could not open markets");
    } finally {
      setOpeningId(null);
    }
  }

  function baseMatchForFixture(fixture: UpcomingFixtureRow): LogMatch {
    const existing = matches.find((m) => m.apiFixtureId === fixture.apiFixtureId);
    if (existing) return existing;
    return logMatchFromUpcomingFixture(fixture, {
      id: newId(),
      settings: comboSettings,
    });
  }

  function applyPick(
    fixture: UpcomingFixtureRow,
    event: MarketViewEvent,
    market: MarketDto,
    closeDrawer: boolean
  ) {
    const pick: BetMarketPick = {
      marketType: market.marketType,
      selectionLabel: market.selectionLabel,
    };
    if (!isBetPickMappable(pick)) {
      setPickError("This market is not supported in Prediction Log yet.");
      return;
    }
    const base = baseMatchForFixture(fixture);
    const { match: updated, mapping } = applyBetPickToLogMatch(base, pick, market.odd);
    if (!mapping) {
      setPickError("This market is not supported in Prediction Log yet.");
      return;
    }
    onChange(upsertFixtureLeg(matches, fixture, updated));
    setPickMetaByFixture((prev) => ({
      ...prev,
      [fixture.apiFixtureId]: {
        marketId: market.id,
        betEventId: event.betEventId,
        pick,
      },
    }));
    setPickError(null);
    if (closeDrawer) {
      setDrawerFixture(null);
      setDrawerEvent(null);
    }
  }

  async function handleQuickPick(
    fixture: UpcomingFixtureRow,
    def: (typeof QUICK_MARKET_DEFS)[number]
  ) {
    setPickError(null);
    setOpeningId(fixture.apiFixtureId);
    try {
      const event = await ensureBetEvent(fixture, true);
      if (!event) {
        setPickError("Could not prepare markets for this fixture.");
        return;
      }
      const res = await fetch(
        `/api/bets/events/${event.betEventId}/markets?refresh=0`
      );
      const data = (await res.json()) as { markets?: MarketDto[] };
      const market = (data.markets ?? []).find(
        (m) =>
          m.marketType === def.marketType && m.selectionLabel === def.selectionLabel
      );
      if (!market) {
        setPickError("Market not loaded — tap the match to open full markets.");
        return;
      }
      applyPick(fixture, event, market, false);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : "Quick pick failed");
    } finally {
      setOpeningId(null);
    }
  }

  function removeLeg(apiFixtureId: number) {
    onChange(matches.filter((m) => m.apiFixtureId !== apiFixtureId));
    setPickMetaByFixture((prev) => {
      const next = { ...prev };
      delete next[apiFixtureId];
      return next;
    });
  }

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const meta of Object.values(pickMetaByFixture)) {
      keys.add(`${meta.betEventId}-${meta.marketId}`);
    }
    return keys;
  }, [pickMetaByFixture]);

  async function handleSaveOdd(marketId: number, odd: number | null) {
    await fetch(`/api/bets/markets/${marketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ odd }),
    });
    if (drawerFixture && drawerEvent) {
      const meta = pickMetaByFixture[drawerFixture.apiFixtureId];
      if (meta?.marketId === marketId) {
        const match = matches.find((m) => m.apiFixtureId === drawerFixture.apiFixtureId);
        if (match) {
          const { match: updated } = applyBetPickToLogMatch(match, meta.pick, odd);
          onChange(upsertFixtureLeg(matches, drawerFixture, updated));
        }
      }
    }
  }

  return (
    <div>
      <p style={{ fontSize: "0.8125rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
        Upcoming matches for the next 7 days. Tap a match to open all markets (1xbet-style),
        pick your line and odds, then save the batch.
      </p>

      <div
        style={{
          display: "flex",
          gap: "0.35rem",
          flexWrap: "wrap",
          marginBottom: "0.75rem",
        }}
      >
        {NEXT_MATCHES_LEAGUES.map((league) => (
          <button
            key={league}
            type="button"
            className={activeLeague === league ? "btn btn-primary" : "btn btn-secondary"}
            style={{ fontSize: "0.8125rem", padding: "0.35rem 0.65rem" }}
            onClick={() => setActiveLeague(league)}
          >
            {league}
            {(fixturesByLeague[league]?.length ?? 0) > 0
              ? ` (${fixturesByLeague[league]!.length})`
              : ""}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: "0.8125rem", marginLeft: "auto" }}
          onClick={() => void loadFixtures(true)}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="page-sub">Loading upcoming fixtures…</p>
      ) : fetchError && visibleFixtures.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>{fetchError}</p>
      ) : visibleFixtures.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
          No fixtures in the next 7 days for {activeLeague}.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "0.65rem" }}>
          {visibleFixtures.map((fixture) => {
            const { date, time } = formatKickoff(fixture.kickoffIso);
            const inBatch = draftHasApiFixtureId(matches, fixture.apiFixtureId);
            const busy = openingId === fixture.apiFixtureId;
            return (
              <div
                key={fixture.apiFixtureId}
                className="card"
                style={{ padding: "0.75rem", opacity: busy ? 0.7 : 1 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    marginBottom: "0.35rem",
                    fontSize: "0.75rem",
                    color: "var(--muted)",
                  }}
                >
                  <span>
                    {date} · {time}
                  </span>
                  {inBatch ? (
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>In batch</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void openFixtureDrawer(fixture)}
                  disabled={busy}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    width: "100%",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span style={{ flex: 1, fontWeight: 600 }}>{fixture.home.name}</span>
                  <span style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>vs</span>
                  <span style={{ flex: 1, fontWeight: 600, textAlign: "right" }}>
                    {fixture.away.name}
                  </span>
                </button>
                {fixture.venue ? (
                  <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                    {fixture.venue}
                  </div>
                ) : null}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem",
                    marginTop: "0.5rem",
                  }}
                >
                  {QUICK_MARKET_DEFS.map((def) => (
                    <button
                      key={`${def.marketType}-${def.selectionLabel}`}
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: "0.75rem", padding: "0.3rem 0.5rem", minWidth: "2.75rem" }}
                      disabled={busy}
                      onClick={() => void handleQuickPick(fixture, def)}
                    >
                      {def.display}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pickError ? (
        <p style={{ color: "#a16207", fontSize: "0.8125rem", marginTop: "0.75rem" }}>{pickError}</p>
      ) : null}

      {matches.length > 0 ? (
        <div className="card" style={{ marginTop: "1rem", padding: "0.75rem" }}>
          <div style={{ fontWeight: 600, fontSize: "0.875rem", marginBottom: "0.5rem" }}>
            Selected legs ({matches.length})
          </div>
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {matches.map((m) => {
              const meta = m.apiFixtureId != null ? pickMetaByFixture[m.apiFixtureId] : undefined;
              const unmapped = meta && !isBetPickMappable(meta.pick);
              const odds =
                m.comboPick?.odds ??
                Object.values(m.predictions)[0]?.odds;
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    alignItems: "center",
                    fontSize: "0.8125rem",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {m.homeTeam} vs {m.awayTeam}
                    </div>
                    <div style={{ color: "var(--muted)" }}>
                      {meta ? betPickDisplayLabel(meta.pick) : matchLegLabel(m)}
                      {odds != null ? ` @ ${odds.toFixed(2)}` : " — enter odds in markets"}
                    </div>
                    {unmapped ? (
                      <div style={{ color: "#a16207", fontSize: "0.75rem" }}>
                        Not supported in Prediction Log
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                    onClick={() => m.apiFixtureId != null && removeLeg(m.apiFixtureId)}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {drawerEvent && drawerFixture ? (
        <MatchMarketView
          event={drawerEvent}
          selectedKeys={selectedKeys}
          subtitle="Tap a market to add it to your batch"
          onClose={() => {
            setDrawerFixture(null);
            setDrawerEvent(null);
          }}
          onToggle={(market) => applyPick(drawerFixture, drawerEvent, market, true)}
          onSaveOdd={handleSaveOdd}
        />
      ) : null}
    </div>
  );
}
