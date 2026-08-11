"use client";

import { Suspense } from "react";
import { TeamsPageBody } from "@/components/teams/teams-page-body";
import { LeagueAnalysisApp } from "@/components/league/league-analysis-app";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getWorkspace } from "@/lib/navigation/workspace-routes";

const workspace = getWorkspace("teams-leagues");

function TeamsLeaguesInner() {
  return (
    <WorkspaceShell
      workspace={workspace}
      subtitle="Team quality staging and league analysis — competition-type rules unchanged."
      panels={[
        { id: "teams", content: <TeamsPageBody /> },
        {
          id: "leagues",
          content: (
            <div>
              <h2 className="page-title" style={{ fontSize: "1.25rem" }}>
                League Analysis
              </h2>
              <p className="page-sub">
                Season-scoped behavioral fingerprints from your logged results. Traits feed a capped
                ±8% adjustment layer in the prediction engine.
              </p>
              <LeagueAnalysisApp />
            </div>
          ),
        },
      ]}
    />
  );
}

export default function TeamsLeaguesPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading Teams & Leagues…</p>}>
      <TeamsLeaguesInner />
    </Suspense>
  );
}
