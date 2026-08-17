"use client";

import { Suspense } from "react";
import { LiveFixturesApp } from "@/components/live/live-fixtures-app";
import { BetCouponApp } from "@/components/bets/bet-coupon-app";
import { NextMatchesApp } from "@/components/fixtures/next-matches-app";
import { PlayApp } from "@/components/ext-bets/play-app";
import { WeekendOpportunitiesApp } from "@/components/match-centre/weekend-opportunities-app";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getWorkspace } from "@/lib/navigation/workspace-routes";

const workspace = getWorkspace("match-centre");

function MatchCentreInner() {
  return (
    <WorkspaceShell
      workspace={workspace}
      subtitle="Live fixtures, coupons, next matches, play access, and weekend opportunistic picks — each tab keeps its own state."
      panels={[
        { id: "live-fixtures", content: <LiveFixturesApp /> },
        {
          id: "bets-coupon",
          content: (
            <main style={{ maxWidth: "72rem", margin: "0 auto" }}>
              <BetCouponApp />
            </main>
          ),
        },
        { id: "next-match", content: <NextMatchesApp /> },
        { id: "play-coupon", content: <PlayApp /> },
        {
          id: "slip-builder",
          content: (
            <Suspense fallback={<p className="page-sub">Loading…</p>}>
              <WeekendOpportunitiesApp />
            </Suspense>
          ),
        },
      ]}
    />
  );
}

export default function MatchCentrePage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading Match Centre…</p>}>
      <MatchCentreInner />
    </Suspense>
  );
}
