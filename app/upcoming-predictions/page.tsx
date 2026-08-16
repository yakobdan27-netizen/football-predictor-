"use client";

import { Suspense } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { UpcomingFormationPanel } from "@/components/upcoming/upcoming-formation-panel";
import { UpcomingHshPanel } from "@/components/upcoming/upcoming-hsh-panel";
import { UpcomingLadderPanel } from "@/components/upcoming/upcoming-ladder-panel";
import { UpcomingPredictionsProvider } from "@/components/upcoming/upcoming-predictions-context";
import { UpcomingTotalGoalsPanel } from "@/components/upcoming/upcoming-total-goals-panel";
import { getWorkspace } from "@/lib/navigation/workspace-routes";

const workspace = getWorkspace("upcoming-predictions");

function UpcomingPredictionsInner() {
  return (
    <UpcomingPredictionsProvider>
      <WorkspaceShell
        workspace={workspace}
        subtitle="Upcoming fixtures from API-Football — same CFE equations as Goals & Survival."
        panels={[
          { id: "half-goals", content: <UpcomingHshPanel /> },
          {
            id: "total-goals",
            content: (
              <Suspense fallback={<p className="page-sub">Loading…</p>}>
                <UpcomingTotalGoalsPanel />
              </Suspense>
            ),
          },
          { id: "survival-ladder", content: <UpcomingLadderPanel /> },
          { id: "formation-reference", content: <UpcomingFormationPanel /> },
        ]}
      />
    </UpcomingPredictionsProvider>
  );
}

export default function UpcomingPredictionsPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading Upcoming Predictions…</p>}>
      <UpcomingPredictionsInner />
    </Suspense>
  );
}
