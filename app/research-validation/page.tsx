"use client";

import { Suspense } from "react";
import { AnalysisApp } from "@/components/prediction-log/analysis-app";
import { RiskEvaluationApp } from "@/components/prediction-log/risk-evaluation-app";
import { BacktestApp } from "@/components/backtest/backtest-app";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getWorkspace } from "@/lib/navigation/workspace-routes";

const workspace = getWorkspace("research-validation");

function ResearchValidationInner() {
  return (
    <WorkspaceShell
      workspace={workspace}
      subtitle="Analysis, risk/evaluation, and backtesting — warnings stay visible; nothing is blocked."
      panels={[
        {
          id: "analysis",
          content: (
            <div>
              <h2 className="page-title" style={{ fontSize: "1.25rem" }}>
                Stats
              </h2>
              <p className="page-sub">
                Recommendation workbench (generate + full math), model diagnostics, exports, and
                performance from your saved data.
              </p>
              <Suspense fallback={<p className="page-sub">Loading stats…</p>}>
                <AnalysisApp />
              </Suspense>
            </div>
          ),
        },
        {
          id: "risk-evaluation",
          content: (
            <div>
              <h2 className="page-title" style={{ fontSize: "1.25rem" }}>
                Risk & Evaluation
              </h2>
              <p className="page-sub">
                Bankroll health, long-term yield, CLV, and a Monte Carlo reality check. Decision
                support only — not guaranteed profit.
              </p>
              <RiskEvaluationApp />
            </div>
          ),
        },
        { id: "back-test", content: <BacktestApp /> },
      ]}
    />
  );
}

export default function ResearchValidationPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading Research & Validation…</p>}>
      <ResearchValidationInner />
    </Suspense>
  );
}
