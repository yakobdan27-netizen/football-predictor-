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
  "Leeds United": "Leeds",
  "Leicester City": "Leicester",
  "Inter Milan": "Inter",
  "AC Milan": "Milan",
  "Bayern München": "Bayern Munich",
  "Borussia Dortmund": "Dortmund",
  "Eintracht Frankfurt": "Ein Frankfurt",
  "RB Leipzig": "RB Leipzig",
  "Paris Saint Germain": "Paris SG",
  "Paris Saint-Germain": "Paris SG",
  PSG: "Paris SG",
  "Athletic Club": "Ath Bilbao",
  "Athletic Bilbao": "Ath Bilbao",
  "Atletico Madrid": "Ath Madrid",
  "Atlético Madrid": "Ath Madrid",
  "AS Monaco": "Monaco",
  "Borussia Mönchengladbach": "M'gladbach",
  "Borussia Monchengladbach": "M'gladbach",
  Frankfurt: "Ein Frankfurt",
  "Real Oviedo": "Oviedo",
  "Rayo Vallecano": "Vallecano",
  Espanyol: "Espanol",
  "Celta Vigo": "Celta",
  "Deportivo Alavés": "Alaves",
  Alavés: "Alaves",
  "Real Betis": "Betis",
  "Real Sociedad": "Sociedad",
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
