import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LEGACY_REDIRECTS,
  MORE_NAV,
  PRIMARY_NAV,
  STANDALONE_PATHS,
  WORKSPACES,
  buildWorkspaceUrl,
  defaultTabId,
  getWorkspace,
  legacyRedirectTarget,
  resolveTabId,
} from "./workspace-routes";

describe("workspace defaults", () => {
  it("each workspace default tab is the first listed tab", () => {
    for (const w of WORKSPACES) {
      assert.equal(defaultTabId(w), w.tabs[0]!.id);
      assert.equal(resolveTabId(w, null), w.tabs[0]!.id);
      assert.equal(resolveTabId(w, "nope"), w.tabs[0]!.id);
      assert.equal(resolveTabId(w, w.tabs[0]!.id), w.tabs[0]!.id);
    }
  });
});

describe("legacy redirects", () => {
  const expected: Record<string, string> = {
    "/live": "/match-centre?tab=live-fixtures",
    "/bets": "/match-centre?tab=bets-coupon",
    "/next-matches": "/match-centre?tab=next-match",
    "/play": "/match-centre?tab=play-coupon",
    "/slips/builder": "/match-centre?tab=slip-builder",
    "/combined-odds": "/combo-centre?tab=combined-odd",
    "/combined-odds-extended": "/combo-centre?tab=extended-combo",
    "/highest-scoring-half": "/goals-survival?tab=half-goals",
    "/total-goals-analysis": "/goals-survival?tab=total-goals",
    "/ladder": "/goals-survival?tab=survival-ladder",
    "/analysis": "/research-validation?tab=analysis",
    "/risk": "/research-validation?tab=risk-evaluation",
    "/backtest": "/research-validation?tab=back-test",
    "/settings": "/settings-guide?tab=settings",
    "/guide": "/settings-guide?tab=guide",
    "/teams": "/teams-leagues?tab=teams",
    "/leagues": "/teams-leagues?tab=leagues",
    "/league-analysis": "/teams-leagues?tab=leagues",
    "/stat": "/research-validation?tab=analysis",
    "/conceded-half-analysis": "/goals-survival?tab=half-goals",
    "/half-comparison-analysis": "/goals-survival?tab=half-goals",
    "/corners-analysis": "/markets-analysis?tab=match-corners",
    "/draw-either-half-analysis": "/markets-analysis?tab=draw-either-half",
  };

  it("maps every legacy path to the correct workspace and tab", () => {
    for (const [legacy, target] of Object.entries(expected)) {
      assert.equal(legacyRedirectTarget(legacy), target, legacy);
      assert.ok(LEGACY_REDIRECTS[legacy], `missing map entry ${legacy}`);
    }
    assert.equal(Object.keys(LEGACY_REDIRECTS).length, Object.keys(expected).length);
  });

  it("does not redirect Decision Maker or Prediction Log", () => {
    for (const path of STANDALONE_PATHS) {
      assert.equal(legacyRedirectTarget(path), null);
      assert.equal(LEGACY_REDIRECTS[path], undefined);
    }
  });

  it("preserves unrelated query params when building redirect", () => {
    const url = buildWorkspaceUrl("research-validation", "analysis", {
      batch: "REC-1",
      tab: "old",
    });
    assert.ok(url.includes("batch=REC-1"));
    assert.ok(url.includes("tab=analysis"));
    assert.ok(!url.includes("tab=old"));
  });
});

describe("primary nav", () => {
  it("exposes primary hrefs including standalones and Markets Analysis", () => {
    assert.equal(PRIMARY_NAV.length, 9);
    const hrefs = PRIMARY_NAV.map((l) => l.href);
    assert.ok(hrefs.includes("/decision-maker"));
    assert.ok(hrefs.includes("/prediction-log"));
    assert.ok(hrefs.includes("/match-centre"));
    assert.ok(hrefs.includes("/markets-analysis"));
    assert.equal(new Set(hrefs).size, 9);
  });

  it("More sheet does not bury Decision Maker, Prediction Log, or Markets Analysis", () => {
    const moreHrefs: string[] = MORE_NAV.map((l) => l.href);
    assert.ok(!moreHrefs.includes("/decision-maker"));
    assert.ok(!moreHrefs.includes("/prediction-log"));
    assert.ok(!moreHrefs.includes("/markets-analysis"));
    assert.ok(!moreHrefs.includes("/corners-analysis"));
    assert.ok(!moreHrefs.includes("/draw-either-half-analysis"));
  });

  it("getWorkspace returns known workspaces", () => {
    assert.equal(getWorkspace("match-centre").title, "Match Centre");
  });
});
