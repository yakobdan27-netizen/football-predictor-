/**
 * Register bet settlement on live fixture FT transitions.
 * Side-effect import from bets API routes / page.
 */
import { onFixtureSettled } from "@/lib/live/settled-bus";
import { settleBetsForFixture } from "./settle";

let registered = false;

export function ensureBetSettlementRegistered(): void {
  if (registered) return;
  registered = true;
  onFixtureSettled(async (payload) => {
    try {
      await settleBetsForFixture(payload.fixtureId);
    } catch (e) {
      console.warn(
        "[bets] settle on fixture.settled failed",
        payload.fixtureId,
        e instanceof Error ? e.message : e
      );
    }
  });
}
