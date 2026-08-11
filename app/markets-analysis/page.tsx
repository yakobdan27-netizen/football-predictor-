"use client";

import { Suspense } from "react";
import { CornersApp } from "@/components/prediction-log/corners-app";
import { HalftimeCornersApp } from "@/components/prediction-log/halftime-corners-app";
import { DiehApp } from "@/components/prediction-log/dieh-app";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getWorkspace } from "@/lib/navigation/workspace-routes";

const workspace = getWorkspace("markets-analysis");

function MarketsAnalysisInner() {
  return (
    <WorkspaceShell
      workspace={workspace}
      subtitle="Match corners, halftime corners, and draw-in-either-half — same models as before, grouped for quick access."
      panels={[
        {
          id: "match-corners",
          content: (
            <Suspense fallback={<p className="page-sub">Loading…</p>}>
              <CornersApp />
            </Suspense>
          ),
        },
        {
          id: "halftime-corners",
          content: (
            <Suspense fallback={<p className="page-sub">Loading…</p>}>
              <HalftimeCornersApp />
            </Suspense>
          ),
        },
        {
          id: "draw-either-half",
          content: (
            <Suspense fallback={<p className="page-sub">Loading…</p>}>
              <DiehApp />
            </Suspense>
          ),
        },
      ]}
    />
  );
}

export default function MarketsAnalysisPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading Markets Analysis…</p>}>
      <MarketsAnalysisInner />
    </Suspense>
  );
}
