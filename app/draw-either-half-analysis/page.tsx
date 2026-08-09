import { Suspense } from "react";
import { DiehApp } from "@/components/prediction-log/dieh-app";

export default function DrawEitherHalfAnalysisPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading…</p>}>
      <DiehApp />
    </Suspense>
  );
}
