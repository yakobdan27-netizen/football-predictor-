import { AiLearnerApp } from "@/components/prediction-log/ai-learner-app";

export default function AiLearnerPage() {
  return (
    <div>
      <h1 className="page-title">AI Learner</h1>
      <p className="page-sub">
        Learned from your saved batches and results (KV-backed; complements API-Football fixture data when configured).
      </p>
      <AiLearnerApp />
    </div>
  );
}
