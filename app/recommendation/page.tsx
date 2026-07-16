import { RecommendationApp } from "@/components/prediction-log/recommendation-app";

export default function RecommendationPage() {
  return (
    <div>
      <h1 className="page-title">Prediction Recommendation</h1>
      <p className="page-sub">
        Batch decision sheet — system pick, selected market, and better alternatives at a glance.
        Generate recommendations and open full analysis on Stats.
      </p>
      <RecommendationApp />
    </div>
  );
}
