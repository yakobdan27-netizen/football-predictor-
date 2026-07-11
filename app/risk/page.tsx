import { RiskEvaluationApp } from "@/components/prediction-log/risk-evaluation-app";

export default function RiskPage() {
  return (
    <div>
      <h1 className="page-title">Risk & Evaluation</h1>
      <p className="page-sub">
        Bankroll health, long-term yield, CLV, and a Monte Carlo reality check. Decision support
        only — not guaranteed profit.
      </p>
      <RiskEvaluationApp />
    </div>
  );
}
