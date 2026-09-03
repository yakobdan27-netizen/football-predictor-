import { OpenAiPredictionsApp } from "@/components/prediction-log/openai-predictions-app";

export default function OpenAiPredictionsPage() {
  return (
    <div>
      <h1 className="page-title">OpenAI Weekend Picks</h1>
      <p className="page-sub">
        Up to 30 AI-selected markets from the Weekend Picks pool, informed by
        canonical fixture estimates, learner stats, and market reliability.
      </p>
      <OpenAiPredictionsApp />
    </div>
  );
}
