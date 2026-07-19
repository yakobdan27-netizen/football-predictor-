import { Suspense } from "react";
import { DecisionMakerApp } from "@/components/prediction-log/decision-maker-app";

export default function DecisionMakerPage() {
  return (
    <Suspense fallback={<p className="page-sub">Loading…</p>}>
      <DecisionMakerApp />
    </Suspense>
  );
}
