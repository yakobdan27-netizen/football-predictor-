/**
 * Settle ext_slips against live_* via the same evaluate() as personal bets.
 * Writes ONLY ext_* tables.
 */
import {
  getEventsForFixture,
  getFixtureById,
  replaceEventsForFixture,
} from "@/lib/live/store";
import { isFinishedStatus, normalizeEvents } from "@/lib/live/normalize";
import { apiSportsLiveProvider } from "@/lib/live/provider";
import { evaluate, type FinalMatchState } from "@/lib/bets/evaluate";
import {
  getExtSelectionsForSlip,
  listOpenExtApiFixtureIdsWithPending,
  listPendingExtSelectionsForApiFixture,
  updateExtSelectionResult,
  updateExtSlipSettlement,
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

  let saw1h = false;
  for (const g of goals) {
    const minute = g.minute ?? 99;
    if (minute <= 45) saw1h = true;
  }
  if (!saw1h && goals.every((g) => g.minute == null)) {
    return { homeGoals1h: null, awayGoals1h: null };
  }

  let h = 0;
  let a = 0;
  for (const g of goals) {
    const minute = g.minute ?? 99;
    if (minute > 45) continue;
    const team = (g.team ?? "").trim();
    if (team === home) h += 1;
    else if (team === away) a += 1;
  }
  return { homeGoals1h: h, awayGoals1h: a };
}

export async function settleExtBetsForFixture(
  apiFixtureId: number
): Promise<{ settledSelections: number; settledSlips: number }> {
  const live = await getFixtureById(apiFixtureId);
  if (!live || !isFinishedStatus(live.status)) {
    return { settledSelections: 0, settledSlips: 0 };
  }

  const pending = await listPendingExtSelectionsForApiFixture(apiFixtureId);
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
      /* half markets may VOID */
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
    const result = evaluate(
      row.marketType,
      row.selection.chosenLabel,
      finalState
    );
    await updateExtSelectionResult(row.selection.id, result);
    settledSelections += 1;
    touchedSlipIds.add(row.slip.id);
  }

  let settledSlips = 0;
  for (const slipId of touchedSlipIds) {
    const sels = await getExtSelectionsForSlip(slipId);
    const slipRow = pending.find((p) => p.slip.id === slipId)?.slip;
    if (!slipRow) continue;

    if (slipRow.slipType === "SINGLE") {
      const r = sels[0]?.result ?? "VOID";
      const status =
        r === "WON" ? "WON" : r === "LOST" ? "LOST" : r === "VOID" ? "VOID" : "SUBMITTED";
      if (status === "SUBMITTED") continue;
      await updateExtSlipSettlement(slipId, {
        status,
        potentialReturn:
          status === "WON"
            ? slipRow.potentialReturn
            : status === "VOID"
              ? slipRow.stake
              : 0,
      });
      settledSlips += 1;
      continue;
    }

    if (sels.some((s) => s.result === "PENDING")) continue;

    if (sels.some((s) => s.result === "LOST")) {
      await updateExtSlipSettlement(slipId, {
        status: "LOST",
        potentialReturn: 0,
      });
      settledSlips += 1;
      continue;
    }

    const active = sels.filter((s) => s.result === "WON");
    const voided = sels.filter((s) => s.result === "VOID");
    if (!active.length && voided.length) {
      await updateExtSlipSettlement(slipId, {
        status: "VOID",
        potentialReturn: slipRow.stake,
        note: "no half data / void legs",
      });
      settledSlips += 1;
      continue;
    }

    const totalOdd = active.reduce((acc, s) => acc * s.chosenOdd, 1);
    await updateExtSlipSettlement(slipId, {
      status: "WON",
      totalOdd: Math.round(totalOdd * 10000) / 10000,
      potentialReturn: Math.round(slipRow.stake * totalOdd * 100) / 100,
      note: voided.length ? `VOID legs dropped (${voided.length})` : slipRow.note,
    });
    settledSlips += 1;
  }

  return { settledSelections, settledSlips };
}

export async function settleAllExtOpenFinished(): Promise<{
  fixtures: number;
  settledSelections: number;
  settledSlips: number;
}> {
  const ids = await listOpenExtApiFixtureIdsWithPending();
  let settledSelections = 0;
  let settledSlips = 0;
  let fixtures = 0;
  for (const id of ids) {
    const live = await getFixtureById(id);
    if (!live || !isFinishedStatus(live.status)) continue;
    fixtures += 1;
    const r = await settleExtBetsForFixture(id);
    settledSelections += r.settledSelections;
    settledSlips += r.settledSlips;
  }
  return { fixtures, settledSelections, settledSlips };
}
