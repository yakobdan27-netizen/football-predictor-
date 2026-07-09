import { RecommendationApp } from "@/components/prediction-log/recommendation-app";

export default function RecommendationPage() {
  return (
    <div>
      <h1 className="page-title">Prediction Recommendation</h1>
      <p className="page-sub">
        Generate recommendations from your saved predictions. Review batch summaries here — open Stats for full analysis.
      </p>
      <RecommendationApp />
    </div>
  );
}
