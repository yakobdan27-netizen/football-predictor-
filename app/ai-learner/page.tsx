import { AiLearnerApp } from "@/components/prediction-log/ai-learner-app";

export default function AiLearnerPage() {
  return (
    <div>
      <h1 className="page-title">AI Learner</h1>
      <p className="page-sub">
        What the system has learned from your saved predictions and results — fully manual, local only.
      </p>
      <AiLearnerApp />
    </div>
  );
}
