import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runMarketAdvisory, toUiPayload } from "./run-msam";
import { minimalCfe } from "./test-fixtures";

describe("run-msam", () => {
  it("produces primary candidates and UI payload", () => {
    const result = runMarketAdvisory({
      fixtureId: 12345,
      matchId: "m1",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      league: "Premier League",
      cfe: minimalCfe(),
      emsSnapshot: {
        kind: "weekend_picks",
        candidates: [],
        snapshotVersion: "test",
      },
      emsKind: "weekend_picks",
      analysis: null,
      calibrator: null,
      cqsBootstrap: true,
      predictionCutoffAt: new Date().toISOString(),
    });

    assert.ok(result.candidates.length > 0);
    assert.ok(["complete", "partial", "insufficient_data"].includes(result.status));
    const ui = toUiPayload(result);
    assert.equal(ui.beta, true);
    assert.ok(Array.isArray(ui.primary));
  });
});
