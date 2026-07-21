import { TeamsQualityApp } from "@/components/teams/teams-quality-app";
import { PlSeasonRosterCard } from "@/components/teams/pl-season-roster-card";
import { LlSeasonRosterCard } from "@/components/teams/ll-season-roster-card";
import { BlSeasonRosterCard } from "@/components/teams/bl-season-roster-card";

export default function TeamsPage() {
  return (
    <div>
      <h1 className="page-title">Teams Quality Staging</h1>
      <p className="page-sub">
        Full roster of clubs and national teams is pre-listed below. Assign each team a quality
        tier (A–D); only saved tier assignments apply tier-gap boosts when generating
        recommendations.
      </p>
      <PlSeasonRosterCard />
      <LlSeasonRosterCard />
      <BlSeasonRosterCard />
      <TeamsQualityApp />
    </div>
  );
}
