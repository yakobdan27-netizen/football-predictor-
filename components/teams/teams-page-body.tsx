import { TeamsQualityApp } from "@/components/teams/teams-quality-app";
import { PlSeasonRosterCard } from "@/components/teams/pl-season-roster-card";
import { LlSeasonRosterCard } from "@/components/teams/ll-season-roster-card";
import { SaSeasonRosterCard } from "@/components/teams/sa-season-roster-card";
import { BlSeasonRosterCard } from "@/components/teams/bl-season-roster-card";
import { L1SeasonRosterCard } from "@/components/teams/l1-season-roster-card";

/** Existing Teams page body — used by Teams & Leagues workspace tab. */
export function TeamsPageBody() {
  return (
    <div>
      <h2 className="page-title" style={{ fontSize: "1.25rem" }}>
        Teams Quality Staging
      </h2>
      <p className="page-sub">
        Full roster of clubs and national teams is pre-listed below. Assign each team a quality
        tier (A–D); only saved tier assignments apply tier-gap boosts when generating
        recommendations.
      </p>
      <PlSeasonRosterCard />
      <LlSeasonRosterCard />
      <SaSeasonRosterCard />
      <BlSeasonRosterCard />
      <L1SeasonRosterCard />
      <TeamsQualityApp />
    </div>
  );
}
