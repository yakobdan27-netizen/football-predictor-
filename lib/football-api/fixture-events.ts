/**
 * GET /fixtures/events — goal timings for Prediction Log (never invent minutes).
 */
import { apiFootballGet } from "./client";
import { fixturePairKey } from "./team-resolve";

export interface FixtureGoalEvent {
  minute: number | null;
  team: string | null;
  player: string | null;
  detail: string | null;
}

type RawEvent = {
  time?: { elapsed?: number | null };
  team?: { name?: string | null };
  player?: { name?: string | null };
  type?: string | null;
  detail?: string | null;
};

export async function fetchFixtureGoalEvents(
  fixtureId: number
): Promise<{ events: FixtureGoalEvent[]; planGated: boolean; error?: string }> {
  try {
    const rows = await apiFootballGet<RawEvent[]>("/fixtures/events", {
      fixture: fixtureId,
    });
    const events = (rows ?? [])
      .filter((e) => (e.type ?? "").toLowerCase() === "goal")
      .map((e) => ({
        minute:
          typeof e.time?.elapsed === "number" && Number.isFinite(e.time.elapsed)
            ? Math.trunc(e.time.elapsed)
            : null,
        team: e.team?.name?.trim() || null,
        player: e.player?.name?.trim() || null,
        detail: e.detail?.trim() || null,
      }));
    return { events, planGated: false };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      events: [],
      planGated: /plan|Free|401|403/i.test(msg),
      error: msg,
    };
  }
}

/** Derive late-goal lean flags from event minutes — only when minutes exist. */
export function goalTimingFromEvents(events: FixtureGoalEvent[]): {
  goalInFirst10?: boolean;
  goalInLast10?: boolean;
  timingBuckets?: {
    g0_15: number;
    g16_30: number;
    g31_45: number;
    g46_60: number;
    g61_75: number;
    g76_90plus: number;
  };
} {
  const minutes = events
    .map((e) => e.minute)
    .filter((m): m is number => m != null);
  if (!minutes.length) return {};
  const buckets = {
    g0_15: 0,
    g16_30: 0,
    g31_45: 0,
    g46_60: 0,
    g61_75: 0,
    g76_90plus: 0,
  };
  for (const m of minutes) {
    if (m <= 15) buckets.g0_15 += 1;
    else if (m <= 30) buckets.g16_30 += 1;
    else if (m <= 45) buckets.g31_45 += 1;
    else if (m <= 60) buckets.g46_60 += 1;
    else if (m <= 75) buckets.g61_75 += 1;
    else buckets.g76_90plus += 1;
  }
  const out: {
    goalInFirst10?: boolean;
    goalInLast10?: boolean;
    timingBuckets?: typeof buckets;
  } = { timingBuckets: buckets };
  if (minutes.some((m) => m <= 10)) out.goalInFirst10 = true;
  else out.goalInFirst10 = false;
  if (minutes.some((m) => m >= 80)) out.goalInLast10 = true;
  else out.goalInLast10 = false;
  return out;
}

/** Earliest goal minute → home / away / none (alias-aware team match). */
export function firstGoalSideFromEvents(
  events: FixtureGoalEvent[],
  homeTeam: string,
  awayTeam: string
): "home" | "away" | "none" {
  const withMinute = events
    .filter((e) => e.minute != null)
    .sort((a, b) => (a.minute ?? 99) - (b.minute ?? 99));
  if (!withMinute.length) return "none";

  const first = withMinute[0]!;
  const team = first.team?.trim();
  if (!team) return "none";

  const homeKey = fixturePairKey(homeTeam, "x").split("|")[0];
  const awayKey = fixturePairKey(awayTeam, "x").split("|")[0];
  const teamKey = fixturePairKey(team, "x").split("|")[0];
  if (teamKey === homeKey) return "home";
  if (teamKey === awayKey) return "away";
  return "none";
}
