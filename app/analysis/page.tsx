import { Suspense } from "react";
import { AnalysisApp } from "@/components/prediction-log/analysis-app";

export default function AnalysisPage() {
  return (
    <div>
      <h1 className="page-title">Stats</h1>
      <p className="page-sub">
        Exports, logging tips, batch comparisons, and performance breakdown from your saved data.
      </p>
      <Suspense fallback={<p className="page-sub">Loading stats…</p>}>
        <AnalysisApp />
      </Suspense>
    </div>
  );
}
