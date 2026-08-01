/**
 * Settle open bet selections when a fixture finishes (FT).
 * Reads results from live_* only; may hydrate events via apiClient into live_events.
 */
import {
  getEventsForFixture,
  getFixtureById,
  replaceEventsForFixture,
} from "@/lib/live/store";
import { isFinishedStatus, normalizeEvents } from "@/lib/live/normalize";
import { apiSportsLiveProvider } from "@/lib/live/provider";
import { evaluate, type FinalMatchState } from "./evaluate";
import {
  getSelectionsForSlip,
  listOpenApiFixtureIdsWithPending,
  listPendingSelectionsForApiFixture,
  updateSelectionResult,
  updateSlipSettlement,
} from "./store";

function halfGoalsFromEvents(
  events: Array<{ minute: number | null; type: string | null; team: string | null }>,
  home: string,
  away: string
): { homeGoals1h: number | null; awayGoals1h: number | null } {
  const goals = events.filter((e) => {
    const t = (e.type ?? "").toLowerCase();
    return t.includes("goal") && !t.includes("missed");
  });
  if (!goals.length) {
    return { homeGoals1h: null, awayGoals1h: null };
  }

  let h = 0;
  let a = 0;
  let saw1h = false;
  for (const g of goals) {
    const minute = g.minute ?? 99;
    // First half: minute <= 45 (+ small HT buffer for 45+ stoppage)
    if (minute <= 45 || minute === 45) {
      saw1h = true;
      const team = (g.team ?? "").toLowerCase();
      if (team && home.toLowerCase().includes(team.slice(0, 5))) h += 1;
      else if (team && away.toLowerCase().includes(team.slice(0, 5))) a += 1;
      else if (team === home.toLowerCase()) h += 1;
      else if (team === away.toLowerCase()) a += 1;
    }
  }

  // If we have goal events but none mapped to 1H, still treat as available zeros
  // only when at least one goal event exists with minute info.
  if (!saw1h && goals.every((g) => g.minute == null)) {
    return { homeGoals1h: null, awayGoals1h: null };
  }

  // Remap with exact team name match
  h = 0;
  a = 0;
  for (const g of goals) {
    const minute = g.minute ?? 99;
    if (minute > 45) continue;
    const team = (g.team ?? "").trim();
    if (team === home) h += 1;
    else if (team === away) a += 1;
  }
  return { homeGoals1h: h, awayGoals1h: a };
}

export async function settleBetsForFixture(
  apiFixtureId: number
): Promise<{ settledSelections: number; settledSlips: number }> {
  const live = await getFixtureById(apiFixtureId);
  if (!live || !isFinishedStatus(live.status)) {
    return { settledSelections: 0, settledSlips: 0 };
  }

  const pending = await listPendingSelectionsForApiFixture(apiFixtureId);
  if (!pending.length) return { settledSelections: 0, settledSlips: 0 };

  let events = await getEventsForFixture(apiFixtureId).catch(() => []);
  if (!events.length) {
    try {
      const raw = await apiSportsLiveProvider.fetchEvents(apiFixtureId);
      const normalized = normalizeEvents(apiFixtureId, raw);
      if (normalized.length) {
        await replaceEventsForFixture(apiFixtureId, normalized);
        events = await getEventsForFixture(apiFixtureId).catch(() => []);
      }
    } catch {
      // Soft-fail — half markets may VOID if still no events
    }
  }
  const half = halfGoalsFromEvents(events, live.homeTeam, live.awayTeam);
  const finalState: FinalMatchState = {
    homeGoals: live.homeGoals,
    awayGoals: live.awayGoals,
    homeGoals1h: half.homeGoals1h,
    awayGoals1h: half.awayGoals1h,
    status: live.status,
  };

  let settledSelections = 0;
  const touchedSlipIds = new Set<number>();

  for (const row of pending) {
    let result = evaluate(
      row.market.marketType,
      row.selection.chosenLabel,
      finalState
    );
    let noteExtra: string | null = null;
    if (
      (row.market.marketType === "1H_OU_0_5" ||
        row.market.marketType === "2H_OU_0_5") &&
      result === "VOID" &&
      (half.homeGoals1h == null || half.awayGoals1h == null)
    ) {
      noteExtra = "no half data";
    }

    await updateSelectionResult(row.selection.id, result);
    settledSelections += 1;
    touchedSlipIds.add(row.slip.id);

    if (noteExtra && !row.slip.note) {
      // note applied at slip recompute
      void noteExtra;
    }
  }

  let settledSlips = 0;
  for (const slipId of touchedSlipIds) {
    const sels = await getSelectionsForSlip(slipId);
    const slipRow = pending.find((p) => p.slip.id === slipId)?.slip;
    if (!slipRow) continue;

    if (slipRow.slipType === "SINGLE") {
      const r = sels[0]?.result ?? "VOID";
      const status =
        r === "WON" ? "WON" : r === "LOST" ? "LOST" : r === "VOID" ? "VOID" : "OPEN";
      if (status === "OPEN") continue;
      await updateSlipSettlement(slipId, {
        status,
        totalOdd: slipRow.totalOdd,
        potentialReturn:
          status === "WON" ? slipRow.potentialReturn : status === "VOID" ? slipRow.stake : 0,
      });
      settledSlips += 1;
      continue;
    }

    // MULTI
    if (sels.some((s) => s.result === "PENDING")) continue;

    if (sels.some((s) => s.result === "LOST")) {
      await updateSlipSettlement(slipId, {
        status: "LOST",
        potentialReturn: 0,
      });
      settledSlips += 1;
      continue;
    }

    const active = sels.filter((s) => s.result === "WON");
    const voided = sels.filter((s) => s.result === "VOID");
    if (!active.length && voided.length) {
      await updateSlipSettlement(slipId, {
        status: "VOID",
        potentialReturn: slipRow.stake,
        note: voided.some((s) => {
          const m = pending.find((p) => p.selection.id === s.id)?.market;
          return (
            m?.marketType === "1H_OU_0_5" || m?.marketType === "2H_OU_0_5"
          );
        })
          ? "no half data"
          : slipRow.note,
      });
      settledSlips += 1;
      continue;
    }

    const totalOdd = active.reduce((acc, s) => acc * s.chosenOdd, 1);
    await updateSlipSettlement(slipId, {
      status: "WON",
      totalOdd: Math.round(totalOdd * 10000) / 10000,
      potentialReturn: Math.round(slipRow.stake * totalOdd * 100) / 100,
      note: voided.length ? `VOID legs dropped (${voided.length})` : slipRow.note,
    });
    settledSlips += 1;
  }

  return { settledSelections, settledSlips };
}

/** Safety-net: settle all finished fixtures that still have PENDING legs. */
export async function settleAllOpenFinished(): Promise<{
  fixtures: number;
  settledSelections: number;
  settledSlips: number;
}> {
  const ids = await listOpenApiFixtureIdsWithPending();
  let settledSelections = 0;
  let settledSlips = 0;
  let fixtures = 0;
  for (const id of ids) {
    const live = await getFixtureById(id);
    if (!live || !isFinishedStatus(live.status)) continue;
    fixtures += 1;
    const r = await settleBetsForFixture(id);
    settledSelections += r.settledSelections;
    settledSlips += r.settledSlips;
  }
  return { fixtures, settledSelections, settledSlips };
}
