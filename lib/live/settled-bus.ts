/**
 * Internal settlement bus for live fixtures.
 * Default: no subscribers that write Prediction Log / manual tables.
 * Future opt-in listeners may suggest API results only — never auto-overwrite.
 */

export interface FixtureSettledPayload {
  fixtureId: number;
  home: string;
  away: string;
  homeGoals: number | null;
  awayGoals: number | null;
  leagueId: number;
  status: string;
}

type Handler = (payload: FixtureSettledPayload) => void | Promise<void>;

const handlers = new Set<Handler>();

export function onFixtureSettled(handler: Handler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export async function emitFixtureSettled(
  payload: FixtureSettledPayload
): Promise<void> {
  for (const h of handlers) {
    try {
      await h(payload);
    } catch (e) {
      console.warn(
        "[live] fixture.settled handler error:",
        e instanceof Error ? e.message : e
      );
    }
  }
}
