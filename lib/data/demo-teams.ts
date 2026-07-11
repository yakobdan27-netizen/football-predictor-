/** Club and national team pools for synthetic demo match generation. */

export interface DemoLeagueGroup {
  id: string;
  teams: readonly string[];
}

export const DEMO_DOMESTIC_LEAGUES: DemoLeagueGroup[] = [
  {
    id: "Premier League",
    teams: [
      "Arsenal", "Aston Villa", "Bournemouth", "Brentford", "Brighton",
      "Burnley", "Chelsea", "Coventry", "Crystal Palace", "Everton", "Fulham",
      "Hull", "Ipswich", "Leeds", "Leicester", "Liverpool", "Man City",
      "Man United", "Newcastle", "Nott'm Forest", "Southampton",
      "Sunderland", "Tottenham", "West Ham", "Wolves",
    ],
  },
  {
    id: "La Liga",
    teams: [
      "Alaves", "Ath Bilbao", "Ath Madrid", "Barcelona", "Betis",
      "Celta", "Elche", "Espanol", "Getafe", "Girona",
      "Las Palmas", "Leganes", "Levante", "Mallorca", "Osasuna",
      "Oviedo", "Real Madrid", "Sevilla", "Sociedad", "Valencia",
      "Valladolid", "Vallecano", "Villarreal",
    ],
  },
  {
    id: "Serie A",
    teams: [
      "Atalanta", "Bologna", "Cagliari", "Como", "Cremonese",
      "Empoli", "Fiorentina", "Genoa", "Inter", "Juventus",
      "Lazio", "Lecce", "Milan", "Monza", "Napoli",
      "Parma", "Pisa", "Roma", "Sassuolo", "Torino",
      "Udinese", "Venezia", "Verona",
    ],
  },
  {
    id: "Bundesliga",
    teams: [
      "Augsburg", "Bayern Munich", "Bochum", "Dortmund", "Ein Frankfurt",
      "FC Koln", "Freiburg", "Hamburg", "Heidenheim", "Hoffenheim",
      "Holstein Kiel", "Leverkusen", "M'gladbach", "Mainz", "RB Leipzig",
      "St Pauli", "Stuttgart", "Union Berlin", "Werder Bremen", "Wolfsburg",
    ],
  },
  {
    id: "Ligue 1",
    teams: [
      "Angers", "Auxerre", "Brest", "Le Havre", "Lens",
      "Lille", "Lorient", "Lyon", "Marseille", "Metz",
      "Monaco", "Montpellier", "Nantes", "Nice", "Paris FC",
      "Paris SG", "Reims", "Rennes", "St Etienne", "Strasbourg",
      "Toulouse",
    ],
  },
];

export const EUROPEAN_CLUB_POOL: readonly string[] = [
  ...new Set(DEMO_DOMESTIC_LEAGUES.flatMap((g) => g.teams)),
].sort();

export const DEMO_UEFA_COMPETITIONS: DemoLeagueGroup[] = [
  { id: "UEFA Champions League", teams: EUROPEAN_CLUB_POOL },
  { id: "UEFA Europa League", teams: EUROPEAN_CLUB_POOL },
  { id: "UEFA Europa Conference League", teams: EUROPEAN_CLUB_POOL },
];

export const DEMO_NATIONAL_TEAMS: DemoLeagueGroup = {
  id: "International",
  teams: [
    "Albania", "Austria", "Belgium", "Bosnia", "Brazil",
    "Croatia", "Czech Republic", "Denmark", "England", "France",
    "Germany", "Greece", "Hungary", "Iceland", "Italy",
    "Netherlands", "Norway", "Poland", "Portugal", "Republic of Ireland",
    "Romania", "Scotland", "Serbia", "Slovakia", "Slovenia",
    "Spain", "Sweden", "Switzerland", "Turkey", "Ukraine",
    "USA", "Wales",
  ],
};

export const DEMO_LEAGUE_GROUPS: DemoLeagueGroup[] = [
  ...DEMO_DOMESTIC_LEAGUES,
  DEMO_NATIONAL_TEAMS,
];

export function allDemoTeams(): string[] {
  return [
    ...new Set(DEMO_LEAGUE_GROUPS.flatMap((g) => g.teams)),
  ].sort();
}
