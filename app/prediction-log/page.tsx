import { PredictionLogApp } from "@/components/prediction-log/prediction-log-app";
import { RealisticExpectationsBanner } from "@/components/prediction-log/realistic-expectations";

export default function PredictionLogPage() {
  return (
    <div>
      <h1 className="page-title">Prediction Log</h1>
      <p className="page-sub">
        Enter batch predictions and match results. Exports, tips, and batch comparisons live on{" "}
        <a href="/analysis">Stats</a>. Long-term risk metrics on{" "}
        <a href="/risk">Risk & Evaluation</a>.
      </p>
      <PredictionLogApp />
      <RealisticExpectationsBanner compact />
    </div>
  );
}
