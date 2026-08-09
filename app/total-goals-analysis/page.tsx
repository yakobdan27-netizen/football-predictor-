import { Suspense } from "react";
import { TotalGoalsApp } from "@/components/prediction-log/total-goals-app";

export default function TotalGoalsAnalysisPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading…</p>}>
      <TotalGoalsApp />
    </Suspense>
  );
}
