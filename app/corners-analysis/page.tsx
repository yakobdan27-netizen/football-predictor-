import { Suspense } from "react";
import { CornersApp } from "@/components/prediction-log/corners-app";

export default function CornersAnalysisPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading…</p>}>
      <CornersApp />
    </Suspense>
  );
}
