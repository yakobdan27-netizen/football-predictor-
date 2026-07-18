import { Suspense } from "react";
import { ConcededHalfApp } from "@/components/prediction-log/conceded-half-app";

export default function ConcededHalfAnalysisPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading…</p>}>
      <ConcededHalfApp />
    </Suspense>
  );
}
