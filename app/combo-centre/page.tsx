"use client";

import { Suspense } from "react";
import { CombinedOddsApp } from "@/components/prediction-log/combined-odds-app";
import { CombinedOddsExtendedApp } from "@/components/prediction-log/combined-odds-extended-app";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getWorkspace } from "@/lib/navigation/workspace-routes";

const workspace = getWorkspace("combo-centre");

function ComboCentreInner() {
  return (
    <WorkspaceShell
      workspace={workspace}
      subtitle="Combined Odd and Extended Combo stay separate — existing probability and correlation rules are unchanged."
      panels={[
        { id: "combined-odd", content: <CombinedOddsApp /> },
        { id: "extended-combo", content: <CombinedOddsExtendedApp /> },
      ]}
    />
  );
}

export default function ComboCentrePage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading Combo Centre…</p>}>
      <ComboCentreInner />
    </Suspense>
  );
}
