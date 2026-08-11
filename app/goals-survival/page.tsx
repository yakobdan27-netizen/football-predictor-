"use client";

import { Suspense } from "react";
import { HshApp } from "@/components/prediction-log/hsh-app";
import { TotalGoalsApp } from "@/components/prediction-log/total-goals-app";
import { LadderApp } from "@/components/prediction-log/ladder-app";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getWorkspace } from "@/lib/navigation/workspace-routes";

const workspace = getWorkspace("goals-survival");

function GoalsSurvivalInner() {
  return (
    <WorkspaceShell
      workspace={workspace}
      subtitle="Half Goals, Total Goals, and Survival Ladder — same sources and equations as before."
      panels={[
        { id: "half-goals", content: <HshApp /> },
        {
          id: "total-goals",
          content: (
            <Suspense fallback={<p className="page-sub">Loading…</p>}>
              <TotalGoalsApp />
            </Suspense>
          ),
        },
        { id: "survival-ladder", content: <LadderApp /> },
      ]}
    />
  );
}

export default function GoalsSurvivalPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading Goals & Survival…</p>}>
      <GoalsSurvivalInner />
    </Suspense>
  );
}
