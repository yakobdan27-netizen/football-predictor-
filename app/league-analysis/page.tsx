import { LeagueAnalysisApp } from "@/components/league/league-analysis-app";

export default function LeagueAnalysisPage() {
  return (
    <div>
      <h1 className="page-title">League Analysis</h1>
      <p className="page-sub">
        Season-scoped behavioral fingerprints from your logged results. Traits feed a capped ±8% adjustment
        layer in the prediction engine.
      </p>
      <LeagueAnalysisApp />
    </div>
  );
}
