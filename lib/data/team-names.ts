/** Shared team name aliases for CSV cleaning and API normalization. */
export const TEAM_ALIASES: Record<string, string> = {
  "Manchester City": "Man City",
  "Manchester United": "Man United",
  "Man Utd": "Man United",
  "Tottenham Hotspur": "Tottenham",
  Tottenham: "Tottenham",
  "Newcastle United": "Newcastle",
  "West Ham United": "West Ham",
  "Brighton and Hove Albion": "Brighton",
  "Brighton & Hove Albion": "Brighton",
  "Wolverhampton Wanderers": "Wolves",
  "Nottingham Forest": "Nott'm Forest",
  "Leicester City": "Leicester",
  "Leeds United": "Leeds",
  "Inter Milan": "Inter",
  "AC Milan": "Milan",
  "Bayern München": "Bayern Munich",
  "Borussia Dortmund": "Dortmund",
  "Eintracht Frankfurt": "Ein Frankfurt",
  "RB Leipzig": "RB Leipzig",
  "Paris Saint Germain": "Paris SG",
  "Paris Saint-Germain": "Paris SG",
  "Athletic Club": "Ath Bilbao",
  "Atletico Madrid": "Ath Madrid",
  "Real Sociedad": "Sociedad",
  "Rayo Vallecano": "Vallecano",
  "Real Valladolid": "Valladolid",
};

export function standardizeTeamName(name: string): string {
  const trimmed = name.trim();
  if (TEAM_ALIASES[trimmed]) return TEAM_ALIASES[trimmed];
  return trimmed
    .replace(/\s+FC$/, "")
    .replace(/\s+AFC$/, "")
    .trim();
}
