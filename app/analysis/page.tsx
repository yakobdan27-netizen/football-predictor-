import { Suspense } from "react";
import { AnalysisApp } from "@/components/prediction-log/analysis-app";

export default function AnalysisPage() {
  return (
    <div>
      <h1 className="page-title">Stats</h1>
      <p className="page-sub">
        Recommendation workbench (generate + full math), model diagnostics, exports, and performance
        from your saved data.
      </p>
      <Suspense fallback={<p className="page-sub">Loading stats…</p>}>
        <AnalysisApp />
      </Suspense>
    </div>
  );
}
